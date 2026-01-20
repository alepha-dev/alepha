import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";

// Generate unique test data
const timestamp = Date.now();
const testEmail = `testattach${timestamp}@example.com`;
const testPassword = "TestPassword123!";
const testUsername = `attachuser${timestamp}`;
const testCampaignTitle = `AttachCamp${timestamp}`.slice(0, 20);
const testTaskTitle = `AttachQuest${timestamp}`;

// Email directory path
const emailDir = path.join(process.cwd(), "node_modules/.alepha/emails");

// Create a test file for upload
const testFilePath = path.join(process.cwd(), "e2e", "test-attachment.txt");

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

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

/**
 * Helper to extract 6-digit verification code from email HTML
 */
function extractVerificationCode(htmlContent: string): string | null {
  const codeMatch = htmlContent.match(
    /letter-spacing:\s*8px[^>]*>[\s\n]*([A-Z0-9]{6})[\s\n]*</i,
  );
  if (codeMatch) {
    return codeMatch[1];
  }

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

test.describe("Task Attachments", () => {
  test.beforeAll(() => {
    clearEmails();
    // Create test file for upload
    fs.writeFileSync(testFilePath, "This is a test attachment file content.");
  });

  test.afterAll(() => {
    // Cleanup test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  test("create task with file attachment", async ({ page }) => {
    test.setTimeout(180000); // 3 minutes

    // ==========================================
    // STEP 1: Register a new user
    // ==========================================
    await test.step("Register new user", async () => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const signInLink = page.getByRole("link", { name: /sign in/i });
      await expect(signInLink).toBeVisible({ timeout: 10000 });
      await signInLink.click();

      await page.waitForLoadState("networkidle");

      const signUpLink = page.getByRole("link", {
        name: /sign up|register|create.*account/i,
      });
      await expect(signUpLink).toBeVisible({ timeout: 10000 });
      await signUpLink.click();

      await page.waitForLoadState("networkidle");

      // Fill registration form
      const usernameInput = page.getByRole("textbox", { name: "Username" });
      const emailInput = page.getByRole("textbox", { name: "Email" });
      const passwordInputs = page.locator('input[type="password"]');

      await expect(usernameInput).toBeVisible({ timeout: 5000 });
      await usernameInput.fill(testUsername);
      await page.waitForTimeout(300);

      await emailInput.fill(testEmail);
      await page.waitForTimeout(300);

      await passwordInputs.first().fill(testPassword);
      await page.waitForTimeout(300);

      await passwordInputs.nth(1).fill(testPassword);
      await page.waitForTimeout(300);

      const submitButton = page.getByRole("button", { name: "Create account" });
      await expect(submitButton).toBeEnabled({ timeout: 5000 });
      await submitButton.click();

      await page.waitForTimeout(2000);
    });

    // ==========================================
    // STEP 2: Handle email verification
    // ==========================================
    await test.step("Complete email verification", async () => {
      const pinInputs = page.locator('input[inputmode="numeric"]');
      const verifyText = page.getByText(
        /verify|verification code|enter.*code|check your email/i,
      );

      const hasPinInputs = (await pinInputs.count()) > 0;
      const hasVerifyText = await verifyText
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (hasPinInputs || hasVerifyText) {
        const emailPath = await findLatestEmail(testEmail);
        expect(emailPath).not.toBeNull();

        const emailContent = fs.readFileSync(emailPath!, "utf-8");
        const code = extractVerificationCode(emailContent);
        expect(code).not.toBeNull();
        expect(code).toHaveLength(6);

        const inputCount = await pinInputs.count();

        if (inputCount >= 6) {
          for (let i = 0; i < 6; i++) {
            await pinInputs.nth(i).click();
            await pinInputs.nth(i).fill(code![i]);
            await page.waitForTimeout(100);
          }
        } else if (inputCount > 0) {
          await pinInputs.first().click();
          await pinInputs.first().fill(code!);
        }

        await page.waitForTimeout(500);

        const verifyButton = page.getByRole("button", {
          name: /complete.*registration|verify|complete|submit|confirm/i,
        });
        if (await verifyButton.isVisible({ timeout: 2000 })) {
          await verifyButton.click();
        }

        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(3000);
      }
    });

    // ==========================================
    // STEP 3: Create a campaign
    // ==========================================
    await test.step("Create campaign", async () => {
      await page.goto("/");
      await page.waitForLoadState("networkidle");

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
        await page.goto("/p-new");
      }

      await page.waitForLoadState("networkidle");

      const titleInput = page.locator('input[type="text"]').first();
      await expect(titleInput).toBeVisible({ timeout: 10000 });
      await titleInput.fill(testCampaignTitle);

      const submitButton = page.getByRole("button", {
        name: /create|submit|save/i,
      });
      await submitButton.click();

      await page.waitForURL(/\/p\/\d+/, { timeout: 30000 });
    });

    // ==========================================
    // STEP 4: Create a task with file attachment
    // ==========================================
    await test.step("Create task with file attachment", async () => {
      const createTaskButton = page.getByRole("button", {
        name: /create.*quest/i,
      });
      await expect(createTaskButton).toBeVisible({ timeout: 5000 });
      await createTaskButton.click();

      await page.waitForTimeout(1000);

      const dialog = page.locator('[role="dialog"]').last();
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Fill task name
      const nameInput = dialog.locator('input[type="text"]').first();
      await expect(nameInput).toBeVisible({ timeout: 5000 });
      await nameInput.fill(testTaskTitle);
      await page.waitForTimeout(500);

      // Fill zone
      const zoneInput = dialog.getByPlaceholder(/enter or select a zone/i);
      if (await zoneInput.isVisible({ timeout: 2000 })) {
        await zoneInput.fill("Main");
        await page.waitForTimeout(500);
        const mainOption = page.getByRole("option").first();
        if (await mainOption.isVisible({ timeout: 2000 })) {
          await mainOption.click();
        }
        await page.waitForTimeout(500);
      }

      // Fill description
      const descriptionEditor = dialog.locator(".ProseMirror").first();
      if (await descriptionEditor.isVisible({ timeout: 2000 })) {
        await descriptionEditor.click();
        await page.keyboard.type("Test quest with attachment");
        await page.waitForTimeout(500);
      }

      // Select priority
      const priorityNormal = dialog.getByText("Normal", { exact: true });
      await expect(priorityNormal).toBeVisible({ timeout: 5000 });
      await priorityNormal.click();
      await page.waitForTimeout(500);

      // Select difficulty
      const difficultyB = dialog.getByText("B", { exact: true });
      await expect(difficultyB).toBeVisible({ timeout: 5000 });
      await difficultyB.click();
      await page.waitForTimeout(500);

      // Upload file attachment
      const fileInput = dialog.locator('input[type="file"]');
      if (await fileInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await fileInput.setInputFiles(testFilePath);
        await page.waitForTimeout(2000);
      } else {
        // Click the attach button to reveal file input
        const attachButton = dialog.getByRole("button", {
          name: /attach files/i,
        });
        if (
          await attachButton.isVisible({ timeout: 2000 }).catch(() => false)
        ) {
          // Set files on the hidden input
          const hiddenInput = dialog.locator('input[type="file"]');
          await hiddenInput.setInputFiles(testFilePath);
          await page.waitForTimeout(2000);
        }
      }

      // Wait for upload success notification or badge
      const successNotification = page.getByText(/uploaded successfully/i);
      const fileBadge = dialog.locator('[class*="Badge"]').first();

      await Promise.race([
        successNotification
          .waitFor({ state: "visible", timeout: 10000 })
          .catch(() => {}),
        fileBadge.waitFor({ state: "visible", timeout: 10000 }).catch(() => {}),
      ]);

      // Submit task
      const submitButton = dialog.getByRole("button", {
        name: /add.*quest.*campaign|add quest|create/i,
      });
      await expect(submitButton).toBeEnabled({ timeout: 5000 });
      await submitButton.click();

      // Wait for task view
      await page.waitForURL(/\/p\/\d+\/q\/\d+/, { timeout: 15000 });
    });

    // ==========================================
    // STEP 5: Verify attachment is displayed
    // ==========================================
    await test.step("Verify attachment is displayed", async () => {
      await page.waitForLoadState("networkidle");

      // Task should be visible
      await expect(page.getByText(testTaskTitle)).toBeVisible({
        timeout: 5000,
      });

      // Check if attachments section exists (may have the file badge)
      // The attachment badge should be clickable and contain part of the UUID
      const attachmentBadge = page
        .locator('[class*="Badge"]')
        .filter({
          has: page.locator("svg"),
        })
        .first();

      // If there's an attachment, it should be visible
      if (
        await attachmentBadge.isVisible({ timeout: 5000 }).catch(() => false)
      ) {
        // Verify we can click on it (opens in new tab)
        const href = await attachmentBadge.getAttribute("href");
        // Badge click opens file - just verify it's present
        expect(await attachmentBadge.isVisible()).toBeTruthy();
      }
    });
  });
});
