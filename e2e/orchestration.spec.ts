import { test, expect } from "@playwright/test";

test.describe("LabQ orchestration client", () => {
  test("bootstraps the environment and creates a project", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto("/");

    await expect(page.getByRole("status")).toContainText("Connected");
    await expect(page.getByRole("status")).toContainText("Synchronized");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await expect(page.getByText("No projects yet")).toBeVisible();

    await page.getByRole("button", { name: "Add project" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByText("Local folder").click();

    await page.getByLabel("Name").fill("Playwright project");
    await page.getByLabel("Folder path").fill("/tmp/playwright-project");
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(/#\/projects\//);
    await expect(page.getByRole("heading", { name: "Playwright project" })).toBeVisible();
    await expect(page.getByText("Local folder · /tmp/playwright-project")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Threads" })).toBeVisible();
    await expect(page.getByText("No threads yet. Create one to start working.")).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test("creates a thread and renders the conversation composer", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

    await page.getByRole("button", { name: "Add project" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByText("Local folder").click();
    await page.getByLabel("Name").fill("Thread E2E project");
    await page.getByLabel("Folder path").fill("/tmp/thread-e2e-project");
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { name: "Thread E2E project" })).toBeVisible();
    await page.getByRole("button", { name: "New thread" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByLabel("Title").fill("Playwright thread");
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

    await expect(page).toHaveURL(/#\/projects\/[^/]+\/threads\//);
    await expect(page.getByRole("heading", { name: "Playwright thread" })).toBeVisible();
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText(
      "No activity yet. Send a prompt to start.",
    );
    await expect(page.getByLabel("Prompt")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

    // Send a prompt
    await page.getByLabel("Prompt").fill("Hello agent");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
    await page.getByRole("button", { name: "Send" }).click();

    // Verify turn card appears in conversation log
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText("Hello agent");
  });

  test("executes end-to-end project and thread workspace flow with capabilities and navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("status")).toContainText("Connected");

    // Create project
    await page.getByRole("button", { name: "Add project" }).first().click();
    await page.getByText("Local folder").click();
    await page.getByLabel("Name").fill("Full Flow Project");
    await page.getByLabel("Folder path").fill("/tmp/full-flow-project");
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

    await expect(page.getByRole("heading", { name: "Full Flow Project" })).toBeVisible();

    // Open New Thread dialog and verify capabilities explanation
    await page.getByRole("button", { name: "New thread" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByText("Plan workflow mode is unsupported in Pi v1 delivery."),
    ).toBeVisible();

    // Configure thread
    await page.getByLabel("Title").fill("Configured Execution Thread");
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

    // Verify thread workspace metadata header
    await expect(page.getByRole("heading", { name: "Configured Execution Thread" })).toBeVisible();
    await expect(page.getByText(/Provider: Pi · pi-default/)).toBeVisible();

    // Send prompt through composer
    await page.getByLabel("Prompt").fill("Execute orchestration task");
    await page.getByRole("button", { name: "Send" }).click();

    // Verify turn timeline card in conversation log
    const conversationLog = page.getByRole("log", { name: "Conversation" });
    await expect(conversationLog).toContainText("Execute orchestration task");

    // Navigate back to project workspace via back link
    await page.getByRole("link", { name: /← Full Flow Project/ }).click();
    await expect(page.getByRole("heading", { name: "Full Flow Project" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Active Threads" })).toContainText("Configured Execution Thread");
  });
});
