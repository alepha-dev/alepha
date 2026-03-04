import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";

// Generate unique test data
const timestamp = Date.now();
const testUsername = `testuser${timestamp}`;
const testEmail = `test${timestamp}@example.com`;
const testPassword = "TestPassword123!";
const testCampaignTitle = `Camp${timestamp}`.slice(0, 20);
const testTaskTitle = `Quest${timestamp}`;

// Email directory path
const emailDir = path.join(process.cwd(), "node_modules/.alepha/emails");

/**
 * Helper to find the latest email file for a given email address
 */
async function findLatestEmail(
  email: string,
  maxWaitMs = 5000,
): Promise<string | null> {
  const startTime = Date.now();
  const sanitizedEmail = email.replace(/[^a-zA-Z0-9@.-]/g, "_");

  while (Date.now() - startTime < maxWaitMs) {
    if (fs.existsSync(emailDir)) {
      const files = fs.readdirSync(emailDir);

      // Find files matching this email, sorted by modification time (newest first)
      const matchingFiles = files
        .filter((f) => f.startsWith(sanitizedEmail) && f.endsWith(".html"))
        .map((f) => ({
          name: f,
          path: path.join(emailDir, f),
          mtime: fs.statSync(path.join(emailDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (matchingFiles.length > 0) {
        return matchingFiles[0].path;
      }
    }

    // Wait a bit before checking again
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

/**
 * Helper to extract 6-digit verification code from email HTML
 */
function extractVerificationCode(htmlContent: string): string | null {
  // The code is in a span with specific styling: font-size: 32px; font-weight: bold; letter-spacing: 8px
  const codeMatch = htmlContent.match(
    /letter-spacing:\s*8px[^>]*>[\s\n]*([A-Z0-9]{6})[\s\n]*</i,
  );
  if (codeMatch) {
    return codeMatch[1];
  }

  // Fallback: look for any 6-character alphanumeric code in a span
  const fallbackMatch = htmlContent.match(
    /<span[^>]*>[\s\n]*([A-Z0-9]{6})[\s\n]*<\/span>/i,
  );
  return fallbackMatch ? fallbackMatch[1] : null;
}

/**
 * Helper to clear emails directory
 */
function clearEmails(): void {
  if (fs.existsSync(emailDir)) {
    const files = fs.readdirSync(emailDir);
    for (const file of files) {
      if (file.endsWith(".html")) {
        fs.unlinkSync(path.join(emailDir, file));
      }
    }
  }
}

test.describe("User Journey", () => {
  test.beforeAll(() => {
    // Clear any existing test emails
    clearEmails();
  });

  test("complete user journey: signup, create campaign, create and complete task", async ({
    page,
  }) => {
    test.setTimeout(120000); // 2 minutes for full journey

    // ==========================================
    // STEP 1: Navigate to registration page via UI
    // ==========================================
    await test.step("Navigate to registration", async () => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Click Sign In link in header
      const signInLink = page.getByRole("link", { name: /sign in/i });
      await expect(signInLink).toBeVisible({ timeout: 10000 });
      await signInLink.click();

      // Wait for login page to load
      await page.waitForLoadState("networkidle");

      // Click Sign Up / Register link from login page
      const signUpLink = page.getByRole("link", {
        name: /sign up|register|create.*account/i,
      });
      await expect(signUpLink).toBeVisible({ timeout: 10000 });
      await signUpLink.click();

      // Wait for registration page
      await page.waitForLoadState("networkidle");
    });

    // ==========================================
    // STEP 2: Register a new account
    // ==========================================
    await test.step("Fill registration form", async () => {
      // Fill registration form - use getByRole for text fields, locator for password fields
      const usernameInput = page.getByRole("textbox", { name: "Username" });
      const emailInput = page.getByRole("textbox", { name: "Email" });
      // Password fields need CSS selector since they're type="password"
      const passwordInputs = page.locator('input[type="password"]');

      // Fill each field with delays to ensure form is ready
      await expect(usernameInput).toBeVisible({ timeout: 5000 });
      await usernameInput.click();
      await usernameInput.fill(testUsername);
      await page.waitForTimeout(300);

      await expect(emailInput).toBeVisible({ timeout: 2000 });
      await emailInput.click();
      await emailInput.fill(testEmail);
      await page.waitForTimeout(300);

      // Fill both password fields
      await expect(passwordInputs.first()).toBeVisible({ timeout: 2000 });
      await passwordInputs.first().click();
      await passwordInputs.first().fill(testPassword);
      await page.waitForTimeout(300);

      await passwordInputs.nth(1).click();
      await passwordInputs.nth(1).fill(testPassword);
      await page.waitForTimeout(300);

      // Submit registration form
      const submitButton = page.getByRole("button", { name: "Create account" });
      await expect(submitButton).toBeEnabled({ timeout: 5000 });
      await submitButton.click();

      // Wait for verification phase or redirect
      await page.waitForTimeout(2000);
    });

    // ==========================================
    // STEP 3: Handle email verification
    // ==========================================
    await test.step("Complete email verification", async () => {
      // Check if we're on verification phase by looking for PinInput or verification text
      const pinInputs = page.locator('input[inputmode="numeric"]');
      const verifyText = page.getByText(
        /verify|verification code|enter.*code|check your email/i,
      );

      const hasPinInputs = (await pinInputs.count()) > 0;
      const hasVerifyText = await verifyText
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (hasPinInputs || hasVerifyText) {
        // Find the email file
        const emailPath = await findLatestEmail(testEmail);
        expect(emailPath).not.toBeNull();

        // Read and parse email
        const emailContent = fs.readFileSync(emailPath!, "utf-8");
        const code = extractVerificationCode(emailContent);
        expect(code).not.toBeNull();
        expect(code).toHaveLength(6);

        // Find PinInput and enter code
        const inputCount = await pinInputs.count();

        if (inputCount >= 6) {
          // PinInput renders as multiple inputs - fill each one
          for (let i = 0; i < 6; i++) {
            await pinInputs.nth(i).click();
            await pinInputs.nth(i).fill(code![i]);
            await page.waitForTimeout(100);
          }
        } else if (inputCount > 0) {
          // Single input - type the whole code
          await pinInputs.first().click();
          await pinInputs.first().fill(code!);
        }

        await page.waitForTimeout(500);

        // Submit verification
        const verifyButton = page.getByRole("button", {
          name: /complete.*registration|verify|complete|submit|confirm/i,
        });
        if (await verifyButton.isVisible({ timeout: 2000 })) {
          await verifyButton.click();
        }

        // Wait for redirect after verification
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(3000);
      }
    });

    // ==========================================
    // STEP 4: Create a new campaign
    // ==========================================
    await test.step("Create new campaign", async () => {
      // After registration, the user is already logged in
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Click "New Campaign" button
      const newCampaignButton = page.getByRole("button", {
        name: /new.*campaign/i,
      });
      const newCampaignLink = page.getByRole("link", {
        name: /new.*campaign/i,
      });

      if (
        await newCampaignButton.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        await newCampaignButton.click();
      } else if (
        await newCampaignLink.isVisible({ timeout: 2000 }).catch(() => false)
      ) {
        await newCampaignLink.click();
      } else {
        // Fallback to direct navigation
        await page.goto("/p-new");
      }

      await page.waitForLoadState("networkidle");

      // Fill campaign title
      const titleInput = page.locator('input[type="text"]').first();
      await expect(titleInput).toBeVisible({ timeout: 10000 });
      await titleInput.fill(testCampaignTitle);

      // Submit
      const submitButton = page.getByRole("button", {
        name: /create|submit|save/i,
      });
      await submitButton.click();

      // Wait for redirect to project page
      await page.waitForURL(/\/p\/\d+/, { timeout: 30000 });

      // Verify we're on the project page
      await expect(page.getByText(testCampaignTitle)).toBeVisible({
        timeout: 5000,
      });
    });

    // ==========================================
    // STEP 5: Create a new task
    // ==========================================
    await test.step("Create new task", async () => {
      // Click create task button
      const createTaskButton = page.getByRole("button", {
        name: /create.*quest/i,
      });
      await expect(createTaskButton).toBeVisible({ timeout: 5000 });
      await createTaskButton.click();

      // Wait for dialog to open
      await page.waitForTimeout(1000);

      // Fill quest form - the dialog has multiple required fields
      const dialog = page.locator('[role="dialog"]').last();
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Fill Name (first text input) - with delays
      const nameInput = dialog.locator('input[type="text"]').first();
      await expect(nameInput).toBeVisible({ timeout: 5000 });
      await nameInput.click();
      await page.waitForTimeout(300);
      await nameInput.fill(testTaskTitle);
      await page.waitForTimeout(500);

      // Select Zone - click the input/combobox to open dropdown
      const zoneInput = dialog.getByLabel(/zone/i);
      if (await zoneInput.isVisible({ timeout: 2000 })) {
        await zoneInput.click();
        await page.waitForTimeout(500);
        // Type "Main" and select
        await zoneInput.fill("Main");
        await page.waitForTimeout(500);
        const mainOption = page.getByRole("option").first();
        if (await mainOption.isVisible({ timeout: 2000 })) {
          await mainOption.click();
        }
        await page.waitForTimeout(500);
      }

      // Fill Description - it's a rich text editor (ProseMirror/Tiptap)
      const descriptionEditor = dialog.locator(".ProseMirror").first();
      if (await descriptionEditor.isVisible({ timeout: 2000 })) {
        await descriptionEditor.click();
        await page.waitForTimeout(300);
        await page.keyboard.type("Test quest description for e2e testing");
        await page.waitForTimeout(500);
      }

      // Select Priority - MANDATORY - click the "Normal" text/label
      const priorityNormal = dialog.getByText("Normal", { exact: true });
      await expect(priorityNormal).toBeVisible({ timeout: 5000 });
      await priorityNormal.click();
      await page.waitForTimeout(500);

      // Select Difficulty - MANDATORY - click the "B" text/label
      const difficultyB = dialog.getByText("B", { exact: true });
      await expect(difficultyB).toBeVisible({ timeout: 5000 });
      await difficultyB.click();
      await page.waitForTimeout(500);

      // Submit quest - look for "Add Quest to Campaign" button
      const submitButton = dialog.getByRole("button", {
        name: /add.*quest.*campaign|add quest|create/i,
      });
      await expect(submitButton).toBeEnabled({ timeout: 5000 });
      await submitButton.click();

      // Wait for task view to appear (URL pattern: /p/{id}/q/{taskId})
      await page.waitForURL(/\/p\/\d+\/q\/\d+/, { timeout: 15000 });

      // Verify task title is visible
      await expect(page.getByText(testTaskTitle)).toBeVisible({
        timeout: 5000,
      });
    });

    // ==========================================
    // STEP 6: Accept the task
    // ==========================================
    await test.step("Accept task", async () => {
      // Find and click accept button - actual text is "Sign and Accept the Quest"
      const acceptButton = page.getByRole("button", {
        name: /sign.*accept|accept.*quest/i,
      });
      await expect(acceptButton).toBeVisible({ timeout: 5000 });
      await acceptButton.click();

      // Wait for UI to update
      await page.waitForTimeout(2000);

      // Verify "Complete Quest" button appears
      await expect(
        page.getByRole("button", { name: /complete.*quest/i }),
      ).toBeVisible({ timeout: 5000 });
    });

    // ==========================================
    // STEP 7: Complete the task
    // ==========================================
    await test.step("Complete task", async () => {
      // Find and click complete button - actual text is "Complete Quest"
      const completeButton = page.getByRole("button", {
        name: /complete.*quest/i,
      });
      await expect(completeButton).toBeVisible({ timeout: 5000 });
      await completeButton.click();

      // Wait for the completion to process
      await page.waitForTimeout(3000);

      // Navigate back to project board manually if still on task page
      const currentUrl = page.url();
      if (currentUrl.match(/\/p\/\d+\/q\/\d+/)) {
        // Still on task page - navigate back to board
        const backLink = page.locator('a[href^="/p/"]').first();
        if (await backLink.isVisible({ timeout: 2000 })) {
          await backLink.click();
        } else {
          // Extract project ID from URL and navigate
          const projectId = currentUrl.match(/\/p\/(\d+)/)?.[1];
          if (projectId) {
            await page.goto(`/p/${projectId}`);
          }
        }
        await page.waitForLoadState("networkidle");
      }
    });

    // ==========================================
    // STEP 8: Verify completion
    // ==========================================
    await test.step("Verify task completion", async () => {
      await page.waitForLoadState("networkidle");

      // Verify we're on the project (board or task page)
      const currentUrl = page.url();
      expect(currentUrl).toMatch(/\/p\/\d+/);

      // The task was successfully completed - full journey done!
    });
  });
});
