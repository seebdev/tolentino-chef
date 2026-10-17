import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDirectory = path.join(root, "docs/evidence");
const sources = [
  {
    file: "live-browser-audit-chrome-public-and-login-harness.json",
    scope: "public",
  },
  {
    file: "live-browser-audit-chrome-bruma-and-cold-login.json",
    scope: "owner",
    keys: ["bruma"],
  },
  {
    file: "live-browser-audit-chrome-owners.json",
    scope: "owner",
    keys: ["aurora"],
  },
  {
    file: "live-browser-audit-chrome-marea-final.json",
    scope: "owner",
    keys: ["marea"],
  },
  { file: "live-browser-audit-edge.json", scope: "all" },
];
const runs = [];
for (const source of sources) {
  const bytes = await readFile(path.join(evidenceDirectory, source.file));
  const data = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  runs.push({
    ...source,
    data,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
if (new Set(runs.map((run) => run.data.base)).size !== 1)
  throw new Error("AUDIT_ORIGIN_MISMATCH");
const publicMenus = runs.flatMap((run) =>
  run.scope === "owner"
    ? []
    : run.data.publicMenus
        .filter((item) => !run.keys || run.keys.includes(item.restaurant))
        .map((item) => ({
          ...item,
          serverMode: run.data.serverMode || "development",
        })),
);
const owners = runs.flatMap((run) =>
  run.scope === "public"
    ? []
    : run.data.owners
        .filter((item) => !run.keys || run.keys.includes(item.restaurant))
        .map((item) => ({
          ...item,
          serverMode: run.data.serverMode || "development",
        })),
);
for (const scenario of [...publicMenus, ...owners]) {
  if (scenario.status !== "PASS") continue;
  const errors = scenario.errors;
  if (
    errors.pageErrors.length ||
    errors.consoleErrors.some((entry) => !entry.expected) ||
    errors.httpErrors.some((entry) => !entry.expected) ||
    errors.failedRequests.some((entry) => !entry.expectedNavigationAbort)
  ) {
    throw new Error(
      `UNEXPECTED_RECORDED_ERRORS_IN_PASSED_SCENARIO:${scenario.browser}/${scenario.restaurant}/${scenario.device || "owner"}`,
    );
  }
}
const selectedResults = runs.flatMap((run) =>
  run.data.results.filter(
    (result) =>
      (run.scope === "all" || result.scope.endsWith("/" + run.scope)) &&
      (!run.keys || run.keys.includes(result.scope.split("/")[1])),
  ),
);
const results = [
  ...new Map(
    selectedResults.map((result) => [
      result.scope + "::" + result.name,
      result,
    ]),
  ).values(),
];
const uniqueScenarios = new Set([
  ...publicMenus.map(
    (item) => `${item.browser}/${item.restaurant}/${item.device}/public`,
  ),
  ...owners.map((item) => `${item.browser}/${item.restaurant}/owner`),
]);
if (
  publicMenus.length !== 18 ||
  owners.length !== 6 ||
  uniqueScenarios.size !== 24
) {
  throw new Error("INCOMPLETE_OR_DUPLICATED_BROWSER_SCENARIOS");
}
const browsers = [
  ...new Map(
    runs
      .flatMap((run) => run.data.browsers)
      .map((browser) => [browser.name, browser]),
  ).values(),
];
const evidence = {
  startedAt: runs.map((run) => run.data.startedAt).sort()[0],
  completedAt: new Date().toISOString(),
  status:
    results.some((result) => result.status === "FAIL") ||
    [...publicMenus, ...owners].some((item) => item.status !== "PASS")
      ? "FAIL"
      : "PASS",
  base: runs[0].data.base,
  applicationScope: runs[0].data.applicationScope,
  serverModes: [
    ...new Set(runs.map((run) => run.data.serverMode || "development")),
  ],
  traffic:
    "Real local Next.js application and remote persisted Supabase data/Auth. No route interception or API fixtures.",
  mutations:
    "Login/logout sessions, rate-limit and noncritical visit counters, browser-local favorites only; no catalog writes, emails or password resets.",
  physicalDevices: false,
  physicalQrScanning: false,
  formalAccessibilityCertification: false,
  consolidation:
    "Final results are deduplicated by browser/tenant/viewport/check. The valid Chrome public scenarios are retained; failed preliminary owner attempts are excluded from final counts and preserved separately.",
  sourceRuns: runs.map(({ file, scope, keys, sha256, data }) => ({
    file: "docs/evidence/" + file,
    selectedScope: scope,
    selectedTenants: keys || "all",
    serverMode: data.serverMode || "development",
    sha256,
    startedAt: data.startedAt,
    completedAt: data.completedAt || data.updatedAt,
  })),
  historicalAttempts: [
    {
      file: "docs/evidence/live-browser-audit-initial-harness-categories.json",
      reason:
        "Harness incorrectly expected empty parent categories as content sections; corrected to navigation plus populated sections.",
    },
    {
      file: "docs/evidence/live-browser-audit-chrome-public-and-login-harness.json",
      reason:
        "Nine public scenarios are final valid evidence. Preliminary owner login attempts did not wait for hydration and are not selected.",
    },
    {
      file: "docs/evidence/live-browser-audit-owner-appearance-before-fix.json",
      reason:
        "Real appearance overflow1557px at1440px caused by hidden file input CSS; fixed and retested.",
    },
    {
      file: "docs/evidence/live-browser-audit-owner-export-harness-and-dev-bom.json",
      reason:
        "Harness used wrong export tab; unrelated package.json BOM temporarily broke development compilation. Both resolved before final rerun.",
    },
    {
      file: "docs/evidence/live-browser-audit-chrome-bruma-and-cold-login.json",
      reason:
        "Bruma owner passed fully and is selected. Aurora cold-development login timed out before POST and is superseded by a fresh production-mode rerun.",
    },
    {
      file: "docs/evidence/live-browser-audit-chrome-owners.json",
      reason:
        "Aurora production owner passed and is selected. Marea completed functional checks but a workspace request received401during logout while reload was still in flight; superseded by a rerun waiting for workspace render and network idle before logout.",
    },
  ],
  browsers,
  publicMenus,
  owners,
  results,
  counts: {
    publicScenarios: publicMenus.length,
    ownerScenarios: owners.length,
    passedScenarios: [...publicMenus, ...owners].filter(
      (item) => item.status === "PASS",
    ).length,
    failedScenarios: [...publicMenus, ...owners].filter(
      (item) => item.status !== "PASS",
    ).length,
    passed: results.filter((result) => result.status === "PASS").length,
    failed: results.filter((result) => result.status === "FAIL").length,
  },
  limitations: [
    "Application origin is localhost; this does not prove an Internet deployment or real-world QR reachability.",
    "Chrome/Edge are desktop installations in headless mode with emulated viewports, not physical phones/tablets.",
    "No installed WebKit was available; Safari was not executed.",
    "Accessibility checks cover DOM labels, image alt attributes, visible keyboard focus and five opaque-background text samples, not a complete audit.",
    "No SMTP email delivery, recovery email flow, physical QR scanning, billing or Render provisioning was exercised by this browser run.",
  ],
};
await writeFile(
  path.join(evidenceDirectory, "live-browser-audit.json"),
  JSON.stringify(evidence, null, 2) + "\n",
  "utf8",
);
console.log(JSON.stringify({ status: evidence.status, ...evidence.counts }));
if (evidence.status !== "PASS") process.exitCode = 1;
