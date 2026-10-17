// Combine explicitly selected destination runs only. Historical source reports
// remain unchanged and cannot satisfy the project/run identity requirements.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  projectRef,
  runId,
  evidenceDirectory,
  evidencePath,
  relativePath,
} from "./audit-target.mjs";

if (!process.env.AUDIT_RUN_ID)
  throw Error("CONSOLIDATION_REQUIRES_EXPLICIT_AUDIT_RUN_ID");
const names = process.argv.slice(2);
if (!names.length || new Set(names).size !== names.length)
  throw Error("EXPLICIT_UNIQUE_SOURCE_REPORTS_REQUIRED");
const runs = names.map((name) => {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/.test(name) ||
    name === "live-browser-consolidated.json"
  )
    throw Error("INVALID_SOURCE_REPORT_FILENAME");
  const file = path.join(evidenceDirectory, name);
  const bytes = readFileSync(file);
  const data = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  if (
    data.projectRef !== projectRef ||
    data.runId !== runId ||
    !data.completedAt
  )
    throw Error("SOURCE_REPORT_TARGET_OR_RUN_MISMATCH");
  return {
    file: relativePath(file),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    data,
  };
});
if (new Set(runs.map((r) => r.data.base)).size !== 1)
  throw Error("SOURCE_REPORT_ORIGINS_DIFFER");
const publicMenus = runs.flatMap((r) => r.data.publicMenus || []);
const owners = runs.flatMap((r) => r.data.owners || []);
const scenarios = [...publicMenus, ...owners];
const identity = (s) =>
  [s.browser, s.restaurant, s.device || "owner"].join("/");
if (
  publicMenus.length !== 18 ||
  owners.length !== 6 ||
  new Set(scenarios.map(identity)).size !== 24
)
  throw Error("INCOMPLETE_OR_DUPLICATED_BROWSER_SCENARIOS");
for (const scenario of scenarios) {
  const e = scenario.errors;
  if (
    scenario.status !== "PASS" ||
    !e ||
    e.pageErrors.length ||
    e.consoleErrors.some((x) => !x.expected) ||
    e.httpErrors.some((x) => !x.expected) ||
    e.failedRequests.some((x) => !x.expectedNavigationAbort)
  )
    throw Error("SOURCE_SCENARIO_NOT_PASSED");
}
const results = runs.flatMap((r) => r.data.results || []);
const ids = results.map((r) => r.scope + "/" + r.name);
if (new Set(ids).size !== ids.length) throw Error("DUPLICATED_BROWSER_CHECKS");
const failed = results.filter((r) => r.status === "FAIL").length;
const report = {
  projectRef,
  runId,
  startedAt: runs.map((r) => r.data.startedAt).sort()[0],
  completedAt: new Date().toISOString(),
  status: failed ? "FAIL" : "PASS",
  base: runs[0].data.base,
  applicationScope: runs[0].data.applicationScope,
  serverModes: [...new Set(runs.map((r) => r.data.serverMode))],
  traffic:
    "Real destination application and Supabase; no route mocks. Source-project and prior-run reports are rejected.",
  mutations:
    "Auth sessions, rate and visit counters, browser-local favorites; no catalog edits by this browser runner.",
  physicalDevices: false,
  physicalQrScanning: false,
  formalAccessibilityCertification: false,
  sourceRuns: runs.map(({ file, sha256, data }) => ({
    file,
    sha256,
    startedAt: data.startedAt,
    completedAt: data.completedAt,
  })),
  publicMenus,
  owners,
  results,
  counts: {
    publicScenarios: publicMenus.length,
    ownerScenarios: owners.length,
    passedScenarios: scenarios.length,
    failedScenarios: 0,
    passed: results.filter((r) => r.status === "PASS").length,
    failed,
  },
  limitations: [
    "Desktop Chrome/Edge with emulated viewports, not physical devices.",
    "Browser results do not establish SMTP delivery, physical QR scanning or a full accessibility certification.",
    "A localhost origin does not establish a public deployment; use the recorded base and applicationScope.",
  ],
};
writeFileSync(
  evidencePath("live-browser-consolidated.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    projectRef,
    runId,
    status: report.status,
    ...report.counts,
  }),
);
if (failed) process.exitCode = 1;
