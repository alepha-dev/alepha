import { expect, type Page, test } from "@playwright/test";
import {
  apiPath,
  createProjectViaWizard,
  newUserContext,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Feedback end-to-end:
 *
 * 1. Owner registers, creates a project, enables the feedback module.
 * 2. Lands on `/p/:id/request?path=…&type=bug`, fills + submits the form, and
 *    is redirected to the reporter's cross-project list at `/me/feedback`
 *    (the dedicated status page was retired in favour of this list).
 * 3. The feedback shows up there as `pending`.
 * 4. Owner accepts the feedback via API.
 * 5. Back on `/me/feedback`, the feedback now shows as `accepted`.
 *
 * Linked-quest progression for reporters was removed with the status page; the
 * feedback <-> quest plumbing lives in the controller unit tests. Other
 * features (quest lifecycle, etc.) have their own specs — see
 * apps/lore/CLAUDE.md for the convention.
 */

const apiPostParams = async <T>(
  page: Page,
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

test.describe("Feedback", () => {
  test("submit via the form, list in /me, owner accepts → status updates", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const email = `petitioner${t}@example.com`;
    const password = "FeedbackTest123!";
    const projectTitle = `Pet${t}`.slice(0, 20);
    const feedbackTitle = `Bug${t}`;
    const feedbackDescription = `Repro:\n1. step one\n2. step two\nExpected: works\nActual: explodes`;
    const reportPath = "/checkout";
    const reportUrl = `https://customer-site.example.com${reportPath}`;

    await registerAndVerify(page, email, password);
    const projectId = await createProjectViaWizard(page, projectTitle);

    // Wizard defaults feedback OFF — flip it on so the request form is
    // reachable.
    await page.evaluate(async (id) => {
      const res = await fetch(`/api/updateProjectById/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { feedback: true } }),
      });
      if (!res.ok)
        throw new Error(`enable feedback: ${res.status} ${await res.text()}`);
    }, projectId);

    // ── Submit feedback through the UI request form ──────────────────────────
    await test.step("submit feedback via the request form", async () => {
      // Land on the request URL with the page-context query params the way the
      // `/sigil/request` proxy delivers them after a feedback-button click.
      await page.goto(
        `/p/${projectId}/request?path=${encodeURIComponent(
          reportPath,
        )}&url=${encodeURIComponent(reportUrl)}&type=bug` +
          `&ua=${encodeURIComponent("CustomUA/9.9")}` +
          `&tz=${encodeURIComponent("Europe/Paris")}`,
      );
      await page.waitForLoadState("networkidle");

      // The request form is a single free-text field — the feedback title is
      // derived from the first line server-side.
      await page
        .locator("textarea")
        .first()
        .fill(`${feedbackTitle}\n${feedbackDescription}`);

      await page.getByRole("button", { name: /^submit feedback$/i }).click();

      // Successful submit redirects to the reporter's /me feedback list.
      await page.waitForURL(/\/auth\/profile\/feedback/, { timeout: 15_000 });
      await expect(page.getByText(feedbackTitle, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    });

    // The list no longer carries the feedback id in the URL — read it back
    // from the reporter list endpoint (most recent first).
    const latest = await page.evaluate(async () => {
      const r = await fetch("/api/me/feedback", { credentials: "include" });
      if (!r.ok) throw new Error(`list mine: ${r.status} ${await r.text()}`);
      const data = (await r.json()) as {
        content: Array<{
          id: number;
          source?: { hostUrl?: string; userAgent?: string; timezone?: string };
        }>;
      };
      return data.content[0] ?? null;
    });
    const feedbackId = latest?.id ?? 0;
    expect(feedbackId).toBeGreaterThan(0);

    // The sigil/proxy query params must be captured as the feedback `source`
    // provenance the owner sees in the inbox.
    await test.step("captures page-context source from the request URL", () => {
      expect(latest?.source?.hostUrl).toBe(reportUrl);
      expect(latest?.source?.userAgent).toBe("CustomUA/9.9");
      expect(latest?.source?.timezone).toBe("Europe/Paris");
    });

    await test.step("feedback shows as pending in the list", async () => {
      const row = page.getByRole("row").filter({ hasText: feedbackTitle });
      await expect(row).toContainText(/pending/i);
    });

    // ── Owner accepts the feedback (API) ─────────────────────────────────────
    await test.step("accept the feedback (API)", async () => {
      await apiPostParams(page, "acceptFeedback", {
        projectId: String(projectId),
        feedbackId: String(feedbackId),
      });
    });

    await test.step("list reflects the accepted status", async () => {
      await page.goto("/auth/profile/feedback");
      await page.waitForLoadState("networkidle");
      const row = page.getByRole("row").filter({ hasText: feedbackTitle });
      await expect(row).toContainText(/accepted/i, { timeout: 10_000 });
    });
  });

  test("cancel from the request form never 403s a non-member into the error page", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const ownerEmail = `owner${t}@example.com`;
    const projectTitle = `Cxl${t}`.slice(0, 20);

    await registerAndVerify(page, ownerEmail, "OwnerPass123!");
    const projectId = await createProjectViaWizard(page, projectTitle);

    // Open the feedback module so the request form is reachable.
    await page.evaluate(async (id) => {
      const res = await fetch(`/api/updateProjectById/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { feedback: true } }),
      });
      if (!res.ok)
        throw new Error(`enable feedback: ${res.status} ${await res.text()}`);
    }, projectId);

    // A different logged-in user who is NOT a member of the project — the
    // exact case that used to break: Cancel pushed to the members-only
    // project view → 403 → "Oh no! Something went wrong" (feedback #7).
    const reporter = await newUserContext(browser, baseURL!, "reporter");
    try {
      await reporter.page.goto(`/p/${projectId}/request`);
      await reporter.page.waitForLoadState("networkidle");
      // The free-text field confirms the form rendered for the non-member.
      await expect(reporter.page.locator("textarea").first()).toBeVisible({
        timeout: 15_000,
      });

      await reporter.page.getByRole("button", { name: /^cancel$/i }).click();
      await reporter.page.waitForLoadState("networkidle");

      // Must NOT land on the crash boundary, and must NOT be sitting on the
      // members-only project view.
      await expect(
        reporter.page.getByText(/something went wrong/i),
      ).toHaveCount(0);
      expect(reporter.page.url()).not.toMatch(
        new RegExp(`/p/${projectId}(?:/|$)`),
      );
    } finally {
      await reporter.ctx.close();
    }
  });
});
