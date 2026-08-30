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
 * 2. Lands on `/:projectSlug/request?path=…&type=bug`, fills + submits the form, and
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
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

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
        `/${projectSlug}/request?path=${encodeURIComponent(
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

      // Successful submit redirects to the reporter's own feedback list.
      await page.waitForURL(/\/account\/feedback/, { timeout: 15_000 });
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
      await page.goto("/account/feedback");
      await page.waitForLoadState("networkidle");
      const row = page.getByRole("row").filter({ hasText: feedbackTitle });
      await expect(row).toContainText(/accepted/i, { timeout: 10_000 });
    });
  });

  /**
   * Feedback #2013: "I don't see my attachment on the Drawer of Edit
   * Feedback."
   *
   * The drawer rendered title, description, tags and the discussion and
   * stopped there, so a report submitted WITH a screenshot looked exactly
   * like one submitted without. The data was already on the resource
   * (`attachmentUrls`) and the owner's detail view already rendered it; only
   * the reporter's own drawer never asked.
   *
   * It matters most here: feedback is editable only while pending, which is
   * the same window in which a reporter would notice a wrong or missing
   * screenshot, and this was the one place they could not look.
   */
  test("the edit drawer shows a reporter their own attachment", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const withFile = `Attached ${t}`;
    const withoutFile = `Bare ${t}`;

    await registerAndVerify(page, `attach${t}@example.com`, "AttachPass123!");
    const { id: projectId } = await createProjectViaWizard(
      page,
      `AT${t}`.slice(0, 20),
    );
    // The wizard defaults feedback OFF, and the upload endpoint refuses a
    // project whose module is closed.
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

    await page.evaluate(
      async ({ id, withFile, withoutFile }) => {
        // A real 1x1 PNG, so the upload passes the MIME *and* extension
        // checks and the drawer takes the image branch.
        const png =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        const form = new FormData();
        form.append(
          "file",
          new Blob([bytes], { type: "image/png" }),
          "screenshot.png",
        );
        const upload = await fetch(`/api/projects/${id}/feedback/attachments`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!upload.ok)
          throw new Error(`upload: ${upload.status} ${await upload.text()}`);
        const file = (await upload.json()) as { id: string };

        const submit = async (body: unknown) => {
          const res = await fetch(`/api/projects/${id}/feedback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          if (!res.ok)
            throw new Error(`submit: ${res.status} ${await res.text()}`);
        };

        await submit({
          title: withoutFile,
          description: "No screenshot on this one",
          type: "bug",
        });
        await submit({
          title: withFile,
          description: "One screenshot",
          type: "bug",
          attachments: [file.id],
        });
      },
      { id: projectId, withFile, withoutFile },
    );

    await page.goto("/account/feedback");
    await page.waitForLoadState("networkidle");

    await test.step("the attachment is visible, as a thumbnail", async () => {
      await page.getByRole("row").filter({ hasText: withFile }).click();

      const drawer = page.getByRole("dialog");
      await expect(drawer.getByText(/attachments/i)).toBeVisible({
        timeout: 10_000,
      });

      // An image is identified by what it looks like, not by
      // "Screenshot 5.png" — a reporter checking they attached the right one
      // cannot tell from the filename.
      const thumb = drawer.locator('img[alt="screenshot.png"]');
      await expect(thumb).toBeVisible();

      // And it opens full size. `target="_blank"` because the drawer may hold
      // unsaved edits.
      const link = drawer.locator('a:has(img[alt="screenshot.png"])');
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("href", /\/api\/files\//);
    });

    await test.step("a feedback with no attachment shows no section", async () => {
      // An empty "Attachments" heading is a question the reader then has to
      // answer by remembering what they uploaded.
      await page.goto("/account/feedback");
      await page.waitForLoadState("networkidle");
      await page.getByRole("row").filter({ hasText: withoutFile }).click();

      // Waited on the title FIELD, not on text: the drawer edits the title in
      // an input, so `getByText` finds nothing and the absence assertion
      // below would pass against a drawer that had not opened yet.
      const drawer = page.getByRole("dialog");
      await expect(drawer.locator("#feedback-title")).toHaveValue(withoutFile, {
        timeout: 10_000,
      });
      await expect(drawer.getByText(/attachments/i)).toHaveCount(0);
    });
  });

  test("the request form gives a non-member no route into the members-only project", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const ownerEmail = `owner${t}@example.com`;
    const projectTitle = `Cxl${t}`.slice(0, 20);

    await registerAndVerify(page, ownerEmail, "OwnerPass123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

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
    // exact case that used to break: Cancel pushed to the members-only project
    // view → 403 → "Oh no! Something went wrong" (feedback #7).
    //
    // Cancel is gone (#174): it discarded a typed report with no prompt, and
    // in the sigil popup it called `window.close()` on a draft held in
    // `sessionStorage`, which dies with the window. So this no longer drives
    // that button — it asserts the property the button used to threaten, which
    // is now structural: the form offers a non-member NO in-page navigation to
    // the project. Written this way it keeps failing if either the button
    // returns or the new link starts navigating this window.
    const reporter = await newUserContext(browser, baseURL!, "reporter");
    try {
      await reporter.page.goto(`/${projectSlug}/request`);
      await reporter.page.waitForLoadState("networkidle");
      // The free-text field confirms the form rendered for the non-member.
      await expect(reporter.page.locator("textarea").first()).toBeVisible({
        timeout: 15_000,
      });

      await expect(
        reporter.page.getByRole("button", { name: /^cancel$/i }),
      ).toHaveCount(0);

      // The one link out opens the parent browser rather than replacing this
      // document — inside the popup a same-window navigation would trap the
      // whole app in a 540×790 chrome-less window and lose the draft.
      const link = reporter.page.getByRole("link", {
        name: /see my previous reports|voir mes retours/i,
      });
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("href", "/account/feedback");

      // No link anywhere on the form points into the members-only project.
      const projectLinks = reporter.page.locator(
        `a[href^="/${projectSlug}/"], a[href$="/${projectSlug}"]`,
      );
      await expect(projectLinks).toHaveCount(0);

      await expect(
        reporter.page.getByText(/something went wrong/i),
      ).toHaveCount(0);
    } finally {
      await reporter.ctx.close();
    }
  });

  test("the request form says feedback is closed when the module is off", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `closed${t}@example.com`, "ClosedTest123!");
    // The wizard defaults the feedback module OFF — this test deliberately
    // leaves it off. Regression guard for the silent-no-op form: the page used
    // to render the full form (paste hint, attach button, submit) while every
    // action died on the unresolved project id from the 403'd context fetch.
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      `Closed${t}`.slice(0, 20),
    );

    await page.goto(`/${projectSlug}/request`);

    await expect(page.getByText(/feedback is closed/i)).toBeVisible({
      timeout: 15_000,
    });
    // The dead form must not render: no message box, no paste hint, no
    // submit button.
    await expect(page.locator("textarea")).toHaveCount(0);
    await expect(page.getByText(/paste a screenshot/i)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^submit feedback$/i }),
    ).toHaveCount(0);
  });
});
