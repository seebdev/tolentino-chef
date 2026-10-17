import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";

const targetProjectRef = "hgntppemxwcxaxritnfq";
const readEnv = (file) =>
  fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};
const target = readEnv(".env.migration.local");
if (target.TARGET_SUPABASE_URL !== `https://${targetProjectRef}.supabase.co`)
  throw new Error("MIGRATION_TARGET_MISMATCH");
const source = readEnv(".env.local");
// Never load or reuse the previously exposed source DB/admin password.
const secrets = [
  source.SUPABASE_SERVICE_ROLE_KEY,
  source.RENDER_API_KEY,
  source.SUPABASE_ACCESS_TOKEN,
  target.TARGET_SUPABASE_SERVICE_ROLE_KEY,
  target.TARGET_RENDER_API_KEY,
  target.SUPABASE_ACCESS_TOKEN,
  ...(target.TARGET_SUPABASE_DB_PASSWORD_ROTATED === "true"
    ? [target.TARGET_SUPABASE_DB_PASSWORD]
    : []),
];
const privateFiles = [
  ".runtime/demo-accounts.json",
  `.runtime/migrations/${targetProjectRef}/accounts.json`,
  `.runtime/migrations/${targetProjectRef}/admin-account.json`,
];
function collectPasswords(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "password" && typeof item === "string") secrets.push(item);
    else if (item && typeof item === "object") collectPasswords(item);
  }
}
for (const file of privateFiles)
  if (fs.existsSync(file))
    collectPasswords(JSON.parse(fs.readFileSync(file, "utf8")));
const needles = [...new Set(secrets.filter(Boolean))].map((value) =>
  Buffer.from(value),
);
const git = (...args) =>
  execFileSync("git", args, {
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
const findings = new Map();
function flag(file, kind) {
  findings.set(`${file}:${kind}`, { file, kind });
}
function scan(file, bytes) {
  if (needles.some((value) => bytes.includes(value)))
    flag(file, "known-secret");
  const text = bytes.toString("utf8");
  if (/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(text))
    flag(file, "private-key");
  if (/\bsb_secret_[A-Za-z0-9_-]{20,}/.test(text))
    flag(file, "supabase-secret-key");
  for (const match of text.matchAll(
    /\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]{30,}\b/g,
  )) {
    try {
      if (
        JSON.parse(Buffer.from(match[1], "base64url").toString()).role ===
        "service_role"
      )
        flag(file, "service-role-jwt");
    } catch {
      /* Not a JSON JWT payload. */
    }
  }
}
const names = (args) =>
  git(...args)
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
const working = names([
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
]);
for (const file of new Set(working)) {
  if (
    file !== ".env.example" &&
    /(^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$|(^|\/)\.runtime\//i.test(file)
  )
    flag(file, "private-file-tracked");
  if (fs.existsSync(file) && fs.statSync(file).isFile())
    scan(file, fs.readFileSync(file));
}
const staged = names(["ls-files", "--stage", "-z"]);
for (const entry of staged) {
  const match = entry.match(/^\d+ ([a-f0-9]+) \d\t([\s\S]+)$/);
  if (match) scan(`index:${match[2]}`, git("cat-file", "blob", match[1]));
}
let historyBlobs = 0;
for (const line of git("rev-list", "--objects", "--all")
  .toString("utf8")
  .split("\n")
  .filter(Boolean)) {
  const id = line.split(" ")[0];
  if (git("cat-file", "-t", id).toString().trim() === "blob") {
    scan(`history:${id}`, git("cat-file", "blob", id));
    historyBlobs++;
  }
}
let browserBundleFiles = 0;
function scanDirectory(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    // Windows/OneDrive may report a directory as a reparse-point Dirent.
    const stat = fs.statSync(file);
    if (stat.isDirectory()) scanDirectory(file);
    else {
      scan(file, fs.readFileSync(file));
      browserBundleFiles++;
    }
  }
}
if (fs.existsSync(".next/static")) scanDirectory(".next/static");
const ignored = [
  ".env.local",
  ".env.migration.local",
  ".runtime/backups",
  `.runtime/migrations/${targetProjectRef}`,
  ...privateFiles,
].map((file) => {
  try {
    return {
      file,
      ignored: Boolean(git("check-ignore", file).toString().trim()),
    };
  } catch {
    return { file, ignored: false };
  }
});
for (const item of ignored)
  if (!item.ignored) flag(item.file, "private-path-not-ignored");
const report = {
  checkedAt: new Date().toISOString(),
  targetProjectRef,
  commit: git("rev-parse", "HEAD").toString().trim(),
  scope:
    "Working files, Git index, reachable history, existing browser bundles. Known server/API secrets and locally protected DEMO/new admin passwords; generic private key and Supabase server token markers. Previously exposed source DB/admin password not used.",
  newEnvironmentBundleVerified: false,
  exactSecretsChecked: needles.length,
  workingFiles: new Set(working).size,
  indexEntries: staged.length,
  historyBlobs,
  browserBundleFiles,
  ignored,
  findings: [...findings.values()],
  passed: findings.size === 0,
};
const folder = `docs/evidence/migrations/${targetProjectRef}/${report.checkedAt.replace(/[:.]/g, "")}`;
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(
  `${folder}/secret-scan.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      ...report,
      findings: findings.size,
      evidence: `${folder}/secret-scan.json`,
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
