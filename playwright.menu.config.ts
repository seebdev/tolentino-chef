import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["menu-closure.spec.ts", "menu-layout-matrix.spec.ts"],
  outputDir: "test-results/menu-closure-browsers",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 20000 },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.E2E_RESULTS_FILE || "docs/evidence/closure-browsers.json",
      },
    ],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3002",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", channel: "chrome" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
    { name: "edge", use: { browserName: "chromium", channel: "msedge" } },
  ],
});
