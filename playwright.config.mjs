import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.mjs",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ],
  webServer: {
    command: "node automation/serve-static-test.mjs",
    url: "http://127.0.0.1:4173/home.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
