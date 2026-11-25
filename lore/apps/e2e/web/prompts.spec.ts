import type { Page } from "@playwright/test";
import WebSocket from "ws";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  apiPost,
  createHostInProject,
  createProjectViaWizard,
  registerAndVerify,
  releasePointerEvents,
} from "./_helpers.ts";

/**
 * Settings > Prompts (#E174, #Q4280), in place of the automations page: the
 * built-ins listed, a copy that fills its quest arg, a duplicate saved as a
 * custom prompt, a built-in's source changed, a weekly trigger set, and a run
 * on an Agent host that lands on its job's page.
 *
 * ⚠️ Every `$action` the SPA calls goes through `POST /api/_batch`, so the
 * assertions are on rendered state or on a read over the page's session,
 * never on a named response.
 */
const apiCall = async <T>(
  page: Page,
  action: string,
  method: string,
  path: Record<string, string | number>,
  body?: unknown,
): Promise<T> => {
  let url = await apiPath(page, action);
  for (const [key, value] of Object.entries(path)) {
    url = url.replace(`:${key}`, String(value));
  }
  return (await page.evaluate(
    async ({ url, method, body }) => {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.status === 204 ? null : r.json();
    },
    { url, method, body },
  )) as T;
};

/**
 * A machine that says yes to everything: hello, then a `done` ack with exit
 * 0 for every command Lore pushes, so the Agent host's check passes and a
 * run's job is picked up. `ws`, since the handshake carries the secret in a
 * header the WHATWG API cannot set.
 */
const playMachine = (baseURL: string, secret: string): WebSocket => {
  const socket = new WebSocket(`${baseURL.replace(/^http/, "ws")}/ws/estates`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  socket.on("open", () => socket.send(JSON.stringify({ type: "hello" })));
  socket.on("message", (raw) => {
    const text = Buffer.isBuffer(raw)
      ? raw.toString("utf8")
      : Array.isArray(raw)
        ? Buffer.concat(raw).toString("utf8")
        : Buffer.from(raw).toString("utf8");
    const frame = JSON.parse(text) as { type?: string; id?: string };
    if (frame.type !== "command" || !frame.id) return;
    socket.send(
      JSON.stringify({ type: "ack", id: frame.id, status: "running" }),
    );
    socket.send(
      JSON.stringify({
        type: "ack",
        id: frame.id,
        status: "done",
        exitCode: 0,
        // An agent's final reply, as Bay returns it (#Q4288).
        result: "All clear: **no** advisory.",
      }),
    );
  });
  return socket;
};

interface PromptRow {
  name: string;
  title: string;
  builtin: boolean;
  source: string;
  on: string;
}

test.describe("Settings > Prompts", () => {
  test("copies with an arg, duplicates, edits a source, sets a weekly trigger and runs on a host", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    let machine: WebSocket | undefined;
    const t = Date.now();
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await registerAndVerify(page, `prompts-${t}@example.com`, "GoodPassw0rd");
    const project = await createProjectViaWizard(page, "Prompts Walk", {
      capabilities: ["plan", "ship"],
    });
    const quest = await apiPost<{ shortId: number }>(page, "createQuest", {
      projectId: project.id,
      title: `Fix the cart ${t}`,
      description: "Seeded for the prompts page",
      area: "Main",
      priority: "low",
      objectives: [],
      attachments: [],
    });
    const prompts = async () =>
      (
        await apiCall<{ items: PromptRow[] }>(page, "listPrompts", "GET", {
          projectId: project.id,
        })
      ).items;
    const rowOf = (title: string) =>
      page.locator("tbody tr", {
        has: page.getByTestId("prompt-title").getByText(title, {
          exact: true,
        }),
      });
    const act = async (title: string, action: string) => {
      await rowOf(title)
        .getByRole("button", { name: /actions/i })
        .click();
      await page.getByRole("menuitem", { name: action, exact: true }).click();
    };

    await test.step("the built-ins are listed, and Run waits for a host", async () => {
      await page.goto(`/${project.slug}/settings/prompts`);
      await expect(rowOf("Work on quest")).toBeVisible({ timeout: 15_000 });
      await expect(rowOf("Weekly status")).toBeVisible();
      await expect(
        page.getByText("Run needs an Agent host that is ready:"),
      ).toBeVisible();
    });

    await test.step("Copy fills the quest arg from its select", async () => {
      await act("Work on quest", "Copy");
      const dialog = page.getByTestId("prompt-run-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("combobox").first().click();
      await page
        .getByRole("option", { name: new RegExp(`Fix the cart ${t}`) })
        .click();
      await dialog.getByTestId("prompt-run-submit").click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await releasePointerEvents(page);
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain(`#Q${quest.shortId}`);
      expect(copied).not.toContain("{{");
    });

    await test.step("Duplicate saves a custom prompt from a built-in", async () => {
      await act("Weekly status", "Duplicate");
      const editor = page.getByTestId("prompt-editor");
      await expect(editor).toBeVisible();
      await editor
        .getByRole("textbox", { name: "Name", exact: true })
        .fill("my-status");
      await editor
        .getByRole("textbox", { name: "Title", exact: true })
        .fill("My status");
      await editor.getByTestId("prompt-save").click();
      await expect(editor).toBeHidden({ timeout: 15_000 });
      await releasePointerEvents(page);
      await expect(rowOf("My status")).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(async () =>
          (await prompts()).find((it) => it.name === "my-status"),
        )
        .toMatchObject({ builtin: false, title: "My status" });
    });

    await test.step("a built-in's source is set without copying its words", async () => {
      await act("Security check", "Source");
      const editor = page.getByTestId("prompt-editor");
      await expect(editor).toBeVisible();
      await editor.getByRole("combobox").first().click();
      await page
        .getByRole("option", { name: "Read-only", exact: true })
        .click();
      await editor.getByTestId("prompt-save").click();
      await expect(editor).toBeHidden({ timeout: 15_000 });
      await releasePointerEvents(page);
      await expect
        .poll(
          async () =>
            (await prompts()).find((it) => it.name === "security-check")
              ?.source,
        )
        .toBe("read");
    });

    await test.step("a weekly trigger is set from its dialog", async () => {
      await act("My status", "Trigger");
      const dialog = page.getByTestId("prompt-trigger");
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("textbox", { name: "Runs", exact: true })
        .fill("weekly@mon@7");
      // A schedule fills no arg: the member it mails is stored with it.
      await dialog
        .getByRole("combobox", { name: "Member for its triggered runs" })
        .click();
      await page.getByRole("option").first().click();
      await dialog.getByTestId("prompt-trigger-save").click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await releasePointerEvents(page);
      await expect(rowOf("My status").getByTestId("prompt-on")).toContainText(
        "weekly@mon@7",
        { timeout: 15_000 },
      );
    });

    await test.step("Run on an Agent host lands on its job's page", async () => {
      const { id: hostId, secret } = await createHostInProject(
        page,
        project.slug,
        "agent-prompts",
      );
      machine = playMachine(baseURL!, secret);
      await apiCall(
        page,
        "updateHost",
        "PATCH",
        { hostId },
        {
          jobsAllowed: true,
        },
      );
      await apiCall(
        page,
        "updateHost",
        "PATCH",
        { hostId },
        {
          agentHost: true,
        },
      );
      // Ready once its agent check came back: `listPromptHosts` names it.
      await expect
        .poll(
          async () =>
            (
              await apiCall<{ hosts: string[] }>(
                page,
                "listPromptHosts",
                "GET",
                { projectId: project.id },
              )
            ).hosts,
          { timeout: 30_000 },
        )
        .toEqual(["agent-prompts"]);
      await page.goto(`/${project.slug}/settings/prompts`);
      await expect(rowOf("Security check")).toBeVisible({ timeout: 15_000 });
      await act("Security check", "Run");
      const dialog = page.getByTestId("prompt-run-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByTestId("prompt-run-submit").click();
      await page.waitForURL(new RegExp(`/${project.slug}/jobs/[^/]+$`), {
        timeout: 20_000,
      });
      await expect(page.getByText("Page not found")).toHaveCount(0);
    });

    await test.step("the job page reads as a transcript with its reply, and its crumb leads to the Jobs tab", async () => {
      await expect(page.getByTestId("job-run-prompt")).toHaveText(
        "Security check",
        { timeout: 15_000 },
      );
      await expect(page.getByTestId("job-aside")).toBeVisible();
      await expect(
        page.getByText("By hand", { exact: false }).first(),
      ).toBeVisible();
      await expect(page.getByTestId("job-reply")).toContainText("All clear", {
        timeout: 15_000,
      });
      await expect(page.getByTestId("job-reply").locator("strong")).toHaveText(
        "no",
      );
      await page
        .getByRole("link", { name: "Jobs", exact: true })
        .first()
        .click();
      await page.waitForURL(`**/${project.slug}/settings/prompts/jobs`);
      await expect(page.getByTestId("job-prompt").first()).toHaveText(
        "Security check",
        { timeout: 15_000 },
      );
      machine?.close();
    });
  });
});
