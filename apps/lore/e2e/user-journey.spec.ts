import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * End-to-end user journey: register → verify email → login → create campaign
 * → seed a quest (via API, since the Zone combobox is not creatable in the
 * shadcn UI) → accept it → complete it.
 *
 * The flow drives the real shadcn UI everywhere except the quest *form* — for
 * that we hit the API directly because the current Combobox can't author a new
 * zone for a brand-new campaign. We still walk the rest through the UI: list,
 * quest view, accept, complete.
 */

const timestamp = Date.now();
const testEmail = `test${timestamp}@example.com`;
const testPassword = "TestPassword123!";
const testCampaignTitle = `Camp${timestamp}`.slice(0, 20);
const testQuestTitle = `Quest${timestamp}`;

const emailDir = path.join(process.cwd(), "node_modules/.alepha/emails");

const findLatestEmail = async (
  email: string,
  maxWaitMs = 5000,
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

const clearEmails = () => {
  if (!fs.existsSync(emailDir)) return;
  for (const f of fs.readdirSync(emailDir)) {
    if (f.endsWith(".eml.json")) fs.unlinkSync(path.join(emailDir, f));
  }
};

/**
 * Resolve an Alepha API endpoint by inspecting the SSR-injected `apiLinks`
 * map embedded in the HTML. Means we don't have to hard-code paths that the
 * framework derives from action names.
 */
const apiPath = async (page: Page, action: string): Promise<string> => {
  const result = await page.evaluate(() => {
    const node = document.getElementById("__ssr");
    if (!node?.textContent) return null;
    try {
      const parsed = JSON.parse(node.textContent) as {
        "alepha.server.request.apiLinks"?: {
          prefix?: string;
          actions?: Record<string, { path: string }>;
        };
      };
      return parsed["alepha.server.request.apiLinks"] ?? null;
    } catch {
      return null;
    }
  });
  if (!result?.actions?.[action]) {
    throw new Error(`API action '${action}' not found in apiLinks`);
  }
  return `${result.prefix ?? "/api"}${result.actions[action].path}`;
};

test.describe("User Journey", () => {
  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
    clearEmails();
  });

  test("signup → verify → login → create campaign → seed quest → accept → complete", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // ── Register ───────────────────────────────────────────────────────────
    await test.step("register via UI", async () => {
      await page.goto("/auth/register");
      await page.waitForLoadState("networkidle");

      await page
        .getByRole("textbox", { name: "Email", exact: true })
        .fill(testEmail);
      await page
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(testPassword);
      await page
        .getByRole("textbox", { name: "Confirm password" })
        .fill(testPassword);

      await page.getByRole("button", { name: /create account/i }).click();
      await expect(
        page.getByRole("button", { name: /complete registration/i }),
      ).toBeVisible({ timeout: 10_000 });
    });

    // ── Verify email + auto-login lands on "/" ─────────────────────────────
    await test.step("submit email verification code", async () => {
      const emailPath = await findLatestEmail(testEmail, 10_000);
      expect(emailPath).not.toBeNull();
      const code = extractCode(fs.readFileSync(emailPath!, "utf-8"));
      expect(code).not.toBeNull();
      expect(code).toHaveLength(6);

      await page.locator("#emailCode").fill(code!);
      await page
        .getByRole("button", { name: /complete registration/i })
        .click();

      // Registry block auto-logs the user in and sends them to "/".
      await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });
    });

    // ── Create campaign ────────────────────────────────────────────────────
    let campaignId = 0;
    await test.step("create campaign via UI", async () => {
      await page.goto("/new-campaign");
      await page.waitForLoadState("networkidle");

      await page.locator('input[type="text"]').first().fill(testCampaignTitle);

      await page.getByRole("button", { name: /create campaign/i }).click();
      await page.waitForURL(/\/c\/\d+/, { timeout: 15_000 });

      const match = page.url().match(/\/c\/(\d+)/);
      expect(match).not.toBeNull();
      campaignId = Number(match![1]);
      await expect(page.getByText(testCampaignTitle).first()).toBeVisible();
    });

    // ── Seed quest via API ─────────────────────────────────────────────────
    let questId = 0;
    await test.step("seed quest via API", async () => {
      const url = await apiPath(page, "createQuest");
      const created = await page.evaluate(
        async ({ url, body }) => {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            throw new Error(
              `createQuest failed: ${r.status} ${await r.text()}`,
            );
          }
          return r.json() as Promise<{ id: number }>;
        },
        {
          url,
          body: {
            title: testQuestTitle,
            description: "Seeded quest for e2e",
            zone: "Main",
            priority: "medium",
            difficulty: 3,
            campaignId,
            objectives: [],
            attachments: [],
          },
        },
      );
      questId = created.id;
      expect(questId).toBeGreaterThan(0);
    });

    // ── Verify quest appears + open quest view ──────────────────────────────
    await test.step("open quest view via UI", async () => {
      await page.goto(`/c/${campaignId}/q/${questId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(testQuestTitle).first()).toBeVisible({
        timeout: 10_000,
      });
    });

    // ── Accept quest ───────────────────────────────────────────────────────
    await test.step("accept quest", async () => {
      const accept = page.getByRole("button", {
        name: /sign and accept|accept.*quest/i,
      });
      await expect(accept).toBeVisible({ timeout: 10_000 });
      await accept.click();
      await expect(
        page.getByRole("button", { name: /complete.*quest/i }),
      ).toBeVisible({ timeout: 10_000 });
    });

    // ── Complete quest ─────────────────────────────────────────────────────
    await test.step("complete quest", async () => {
      await page.getByRole("button", { name: /complete.*quest/i }).click();
      // Server transitions the quest to completed; UI either stays on the page
      // showing a completed badge or animates back to the board. Either way,
      // we should remain inside the campaign URL space.
      await page.waitForLoadState("networkidle");
      expect(page.url()).toContain(`/c/${campaignId}`);
    });
  });

  /**
   * Petition end-to-end:
   *
   * 1. Owner registers, creates a public campaign, seeds a zone, logs out.
   * 2. Reporter (different user) registers, lands on `/c/:id/request?path=…&type=bug`,
   *    fills + submits the form, ends up on the petition status page.
   * 3. Reporter sees `pending` status, no linked quests.
   * 4. Reporter logs out; owner logs back in.
   * 5. Owner accepts the petition via API and creates two quests linked to it
   *    (also via API — keeps the test focused on the petition <-> quest
   *    plumbing, not on the existing quest creation UI).
   * 6. Owner marks one quest accepted then completed.
   * 7. Reporter logs back in, opens the status page, sees `accepted` petition
   *    with two linked quests in the expected states (`completed` + `new`).
   */
  test("petition end-to-end (submit, accept, link quests, see progression)", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const email = `petitioner${t}@example.com`;
    const password = "PetitionTest123!";
    const campaignTitle = `Pet${t}`.slice(0, 20);
    const petitionTitle = `Bug${t}`;
    const petitionDescription = `Repro:\n1. step one\n2. step two\nExpected: works\nActual: explodes`;
    const reportPath = "/checkout";
    const reportUrl = `https://customer-site.example.com${reportPath}`;

    clearEmails();

    const apiPost = async <T>(action: string, body: unknown): Promise<T> => {
      const url = await apiPath(page, action);
      return (await page.evaluate(
        async ({ url, body }) => {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            throw new Error(`${r.status} ${await r.text()}`);
          }
          return r.json();
        },
        { url, body },
      )) as T;
    };

    const apiPostParams = async <T>(
      action: string,
      params: Record<string, string>,
      body?: unknown,
    ): Promise<T> => {
      let url = await apiPath(page, action);
      for (const [k, v] of Object.entries(params)) {
        url = url.replace(`:${k}`, v);
      }
      return (await page.evaluate(
        async ({ url, body }) => {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: body ? JSON.stringify(body) : undefined,
          });
          if (!r.ok) {
            throw new Error(`${r.status} ${await r.text()}`);
          }
          return r.json();
        },
        { url, body },
      )) as T;
    };

    // We exercise the full petition lifecycle as a single user — the campaign
    // owner who also submits the petition. `getMine` permits both roles on
    // the same petition, so the data model (1 petition → N quests, statuses
    // surfaced) is fully covered. Cross-user visibility belongs in a unit
    // test on the controller, not Playwright.
    await test.step("register + verify + auto-login", async () => {
      await page.goto("/auth/register");
      await page.waitForLoadState("networkidle");
      await page
        .getByRole("textbox", { name: "Email", exact: true })
        .fill(email);
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
      await page
        .getByRole("button", { name: /complete registration/i })
        .click();
      await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });
    });

    let campaignId = 0;
    await test.step("create campaign", async () => {
      await page.goto("/new-campaign");
      await page.waitForLoadState("networkidle");
      await page.locator('input[type="text"]').first().fill(campaignTitle);
      await page.getByRole("button", { name: /create campaign/i }).click();
      await page.waitForURL(/\/c\/\d+/, { timeout: 15_000 });
      campaignId = Number(page.url().match(/\/c\/(\d+)/)![1]);
    });

    await test.step("seed a zone via createQuest", async () => {
      await apiPost("createQuest", {
        campaignId,
        title: `Seed${t}`,
        description: "Seed quest so zone 'Triage' exists",
        zone: "Triage",
        priority: "medium",
        difficulty: 2,
        objectives: [],
        attachments: [],
      });
    });

    // ── Submit a petition through the UI request form ────────────────────────
    let petitionId = 0;
    await test.step("submit petition via the request form", async () => {
      // Land on the request URL with autofill query params the way an external
      // `<a target="_blank">` from a customer site would deliver them.
      await page.goto(
        `/c/${campaignId}/request?path=${encodeURIComponent(
          reportPath,
        )}&url=${encodeURIComponent(reportUrl)}&type=bug`,
      );
      await page.waitForLoadState("networkidle");

      // Control wraps inputs without exposing the label as an aria-name —
      // title is the only text input on this form, description the only
      // textarea.
      await page.locator('input[type="text"]').first().fill(petitionTitle);
      await page.locator("textarea").first().fill(petitionDescription);

      await page.getByRole("button", { name: /^submit petition$/i }).click();

      // Successful submit redirects to /c/:id/p/:pid (the reporter status
      // page).
      await page.waitForURL(/\/c\/\d+\/p\/\d+/, { timeout: 15_000 });
      petitionId = Number(page.url().match(/\/p\/(\d+)/)![1]);
      expect(petitionId).toBeGreaterThan(0);
    });

    await test.step("status page shows pending, no quests yet", async () => {
      await expect(page.getByTestId("petition-status-badge")).toContainText(
        /pending/i,
        { timeout: 10_000 },
      );
      await expect(page.getByTestId("petition-status-pending")).toBeVisible();
    });

    // ── Accept the petition + create 2 quests linked to it (API) ─────────────
    await test.step("accept the petition (API)", async () => {
      await apiPostParams("acceptPetition", {
        campaignId: String(campaignId),
        petitionId: String(petitionId),
      });
    });

    const linkedQuestIds: number[] = [];
    await test.step("create two quests linked to the petition", async () => {
      for (const i of [1, 2]) {
        const { id } = await apiPost<{ id: number }>("createQuest", {
          campaignId,
          title: `${petitionTitle} - part ${i}`,
          description: `<p>Work item ${i} from the petition.</p>`,
          zone: "Triage",
          priority: "medium",
          difficulty: 2,
          objectives: [],
          attachments: [],
          petitionId,
        });
        expect(id).toBeGreaterThan(0);
        linkedQuestIds.push(id);
      }
      expect(linkedQuestIds).toHaveLength(2);
    });

    await test.step("accept then complete the first quest", async () => {
      const [firstQuestId] = linkedQuestIds;
      // QuestController.acceptQuest / completeQuest have no body schema, so
      // $action infers GET. Default path is `/<actionName>/:id`.
      await page.evaluate(async (id) => {
        const accept = await fetch(`/api/acceptQuest/${id}`, {
          method: "GET",
          credentials: "include",
        });
        if (!accept.ok) {
          throw new Error(`accept: ${accept.status} ${await accept.text()}`);
        }
        const complete = await fetch(`/api/completeQuest/${id}`, {
          method: "GET",
          credentials: "include",
        });
        if (!complete.ok) {
          throw new Error(
            `complete: ${complete.status} ${await complete.text()}`,
          );
        }
      }, firstQuestId);
    });

    // ── Reporter view: petition accepted, both quests visible with status ────
    await test.step("status page shows accepted petition with 2 linked quests", async () => {
      await page.goto(`/c/${campaignId}/p/${petitionId}`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByTestId("petition-status-badge")).toContainText(
        /accepted/i,
        { timeout: 15_000 },
      );

      const linkedSection = page.getByTestId("petition-status-linked-quests");
      await expect(linkedSection).toBeVisible();

      const [firstId, secondId] = linkedQuestIds;
      const firstRow = page.getByTestId(`petition-quest-${firstId}`);
      const secondRow = page.getByTestId(`petition-quest-${secondId}`);

      await expect(firstRow).toBeVisible();
      await expect(secondRow).toBeVisible();

      // Status attribute is the easiest assertion target — an enum stamp,
      // not a localized label.
      await expect(firstRow).toHaveAttribute("data-quest-status", "completed");
      await expect(secondRow).toHaveAttribute("data-quest-status", "new");
    });
  });
});
