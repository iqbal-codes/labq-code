import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command:
      "bun run build:desktop && python3 -m http.server 4173 --bind 127.0.0.1 --directory 'build/dev-macos-arm64/LabQ Code-dev.app/Contents/Resources/app/views/mainview'",
    url: "http://127.0.0.1:4173",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
