import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";

const emailDir = path.join(process.cwd(), "node_modules/.alepha/emails");

const findLatestEmail = async (
  email: string,
  maxWaitMs = 10_000,
): Promise<string | null> => {
  const start = Date.now();
  const sanitized = email.replace(/[^a-zA-Z0-9@.-]/g, "_");
  while (Date.now() - start < maxWaitMs) {
    if (fs.existsSync(emailDir)) {
      const files = fs
        .readdirSync(emailDir)
        .filter((f) => f.startsWith(sanitized) && f.endsWith(".eml.json"))
        .map((f) => ({
          path: path.join(emailDir, f),
          mtime: fs.statSync(path.join(emailDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0) return files[0].path;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
};

const extractCode = (json: string): string | null => {
  const body = JSON.parse(json).body as string;
  const m =
    body.match(/letter-spacing:\s*8px[^>]*>[\s\n]*([A-Z0-9]{6})[\s\n]*</i) ??
    body.match(/<span[^>]*>[\s\n]*([A-Z0-9]{6})[\s\n]*<\/span>/i);
  return m ? m[1] : null;
};

test.describe("Campaign settings — feature toggles", () => {
  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
    for (const f of fs.readdirSync(emailDir)) {
      if (f.endsWith(".eml.json")) fs.unlinkSync(path.join(emailDir, f));
    }
  });

  test("toggle a feature ON, sidebar updates, persists on reload", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log("BROWSER ERROR:", msg.text());
      }
    });
    page.on("response", async (res) => {
      if (res.url().includes("/api/") && !res.ok()) {
        const body = await res.text().catch(() => "<body unreadable>");
        console.log(
          `API ${res.status()} ${res.request().method()} ${res.url()}: ${body}`,
        );
      }
    });
    const ts = Date.now();
    const email = `feat${ts}@example.com`;
    const password = "GoodPassw0rd";
    const campaignTitle = `Camp${ts}`.slice(0, 20);

    // Register
    await page.goto("/auth/register");
    await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill(password);
    await page
      .getByRole("textbox", { name: "Confirm password" })
      .fill(password);
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(
      page.getByRole("button", { name: /complete registration/i }),
    ).toBeVisible({ timeout: 10_000 });

    const emailPath = await findLatestEmail(email, 10_000);
    expect(emailPath).not.toBeNull();
    const code = extractCode(fs.readFileSync(emailPath!, "utf-8"));
    expect(code).not.toBeNull();
    await page.locator("#emailCode").fill(code!);
    await page.getByRole("button", { name: /complete registration/i }).click();
    await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });

    // Create campaign
    await page.goto("/new-campaign");
    await page.waitForLoadState("networkidle");
    await page.locator('input[type="text"]').first().fill(campaignTitle);
    await page.getByRole("button", { name: /create campaign/i }).click();
    await page.waitForURL(/\/c\/\d+/, { timeout: 15_000 });
    const match = page.url().match(/\/c\/(\d+)/);
    expect(match).not.toBeNull();
    const campaignId = match![1];

    // Sidebar link points to the kanban board (/c/:id/kanban), separate
    // from the settings sub-nav link (/c/:id/settings/kanban).
    const sidebarKanban = page.locator(`a[href="/c/${campaignId}/kanban"]`);

    // Kanban is OFF by default → sidebar link not visible
    await expect(sidebarKanban).toHaveCount(0);

    // Navigate directly to the Kanban settings sub-page
    await page.goto(`/c/${campaignId}/settings/kanban`);
    await page.waitForLoadState("networkidle");

    // Switch should be unchecked
    const kanbanSwitch = page.getByRole("switch", { name: /enable/i });
    await expect(kanbanSwitch).toHaveAttribute("data-state", "unchecked");

    // Toggle ON
    await kanbanSwitch.click();
    await expect(kanbanSwitch).toHaveAttribute("data-state", "checked", {
      timeout: 5_000,
    });

    // Sidebar should now show the board Kanban link
    await expect(sidebarKanban).toBeVisible({ timeout: 5_000 });

    // Reload, verify persistence: Switch still ON and sidebar link still there
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("switch", { name: /enable/i })).toHaveAttribute(
      "data-state",
      "checked",
      { timeout: 5_000 },
    );
    await expect(sidebarKanban).toBeVisible();

    // Toggle back OFF
    await page.getByRole("switch", { name: /enable/i }).click();
    await expect(page.getByRole("switch", { name: /enable/i })).toHaveAttribute(
      "data-state",
      "unchecked",
      { timeout: 5_000 },
    );
    await expect(sidebarKanban).toHaveCount(0);
  });
});
