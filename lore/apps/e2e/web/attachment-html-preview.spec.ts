import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * An HTML attachment opens RENDERED, in a sandboxed frame (#Q3268).
 *
 * This is an e2e because the claim is the browser's, not ours: jsdom does
 * not enforce `sandbox`, so a unit spec could only read the attribute back.
 * The attached file here is hostile on purpose. Its script tries the three
 * things the old "source only" rule existed to prevent, from inside the
 * preview, and writes what happened into its own page.
 *
 * The second half is the code view: a 600-character line and 200 lines used
 * to be cut by the dialog on the right and at the bottom.
 */
test.describe("Attachment viewer - an HTML file", () => {
  test("renders sandboxed, cannot reach the session, and its source scrolls", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const t = Date.now();

    await registerAndVerify(page, `html${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `HT${t}`.slice(0, 20),
    );

    const api = `${baseURL}/api/getQuests/${projectId}`;
    // The control: the same call from Lore's own page is answered, so a
    // refusal inside the frame below is the sandbox and not a dead endpoint.
    expect(
      await page.evaluate(
        async (url) => (await fetch(url, { credentials: "include" })).status,
        api,
      ),
    ).toBe(200);

    const html = [
      "<!doctype html><html><body>",
      '<h1 id="rendered">Mock-up</h1>',
      '<pre id="out">pending</pre>',
      `<!-- ${"long line ".repeat(60)} -->`,
      ...Array.from({ length: 200 }, (_, i) => `<p>row ${i}</p>`),
      "<script>",
      "(async () => {",
      "  const r = {};",
      "  try { r.cookie = 'read:' + document.cookie.length; } catch (e) { r.cookie = 'blocked'; }",
      "  try { localStorage.getItem('x'); r.storage = 'read'; } catch (e) { r.storage = 'blocked'; }",
      `  try { const res = await fetch(${JSON.stringify(api)}, { credentials: 'include' }); r.api = 'status:' + res.status; } catch (e) { r.api = 'blocked'; }`,
      "  document.getElementById('out').textContent = JSON.stringify(r);",
      "})();",
      "</script>",
      "</body></html>",
    ].join("\n");

    const fileId = await page.evaluate(async (html) => {
      const form = new FormData();
      form.append("file", new Blob([html], { type: "text/html" }), "mock.html");
      const res = await fetch("/api/quests/attachments", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error(`upload ${res.status} ${await res.text()}`);
      return ((await res.json()) as { fileId: string }).fileId;
    }, html);

    const quest = await apiPost<{ shortId: number }>(page, "createQuest", {
      projectId,
      title: `Mockup${t}`,
      description: "seeded",
      area: "Main",
      priority: "medium",
      objectives: [],
      attachments: [fileId],
    });

    await page.goto(`/${slug}/quests/${quest.shortId}`);
    await page.getByTitle("mock.html").first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await test.step("the preview runs the file with no way back to Lore", async () => {
      const frame = dialog.getByTestId("attachment-html-preview");
      // Exactly this, and never `allow-same-origin` beside it.
      await expect(frame).toHaveAttribute("sandbox", "allow-scripts");

      const inside = frame.contentFrame();
      await expect(inside.locator("#rendered")).toHaveText("Mock-up");
      // The script ran, which is what makes its three refusals mean something.
      await expect(inside.locator("#out")).not.toHaveText("pending", {
        timeout: 15_000,
      });
      const outcome = JSON.parse(
        (await inside.locator("#out").textContent()) ?? "{}",
      );
      expect(outcome.cookie).toBe("blocked");
      expect(outcome.storage).toBe("blocked");
      expect(outcome.api).not.toBe("status:200");
    });

    await test.step("the code view scrolls inside the dialog", async () => {
      await dialog.getByRole("tab", { name: "Code" }).click();
      const pre = dialog.getByTestId("attachment-text-preview").locator("pre");
      await expect(pre).toContainText("getElementById");

      const box = await pre.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const frame = el.closest('[role="dialog"]')!.getBoundingClientRect();
        return {
          scrollsX: el.scrollWidth > el.clientWidth,
          scrollsY: el.scrollHeight > el.clientHeight,
          insideRight: rect.right <= frame.right,
          insideBottom: rect.bottom <= frame.bottom,
          dialogInView:
            frame.right <= window.innerWidth &&
            frame.bottom <= window.innerHeight &&
            frame.top >= 0,
        };
      });
      expect(box).toEqual({
        scrollsX: true,
        scrollsY: true,
        insideRight: true,
        insideBottom: true,
        dialogInView: true,
      });
    });
  });
});
