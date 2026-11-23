import type { Page } from "@playwright/test";
import WebSocket from "ws";

import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createHostInProject,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Hosts with Ship off (#E166, #Q4058): a project with Plan and Build only
 * finds Hosts under Settings > General, is offered both kinds, adds a Bay
 * host that connects and reports its stats, reads it offline once it
 * leaves, names it its default Agent host and opens the job that check
 * started. The offline ALERT waits five minutes of grace, so its proof is
 * `packages/@lore/core/test/host-monitor.spec.ts`, core alone.
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
 * A fake machine: connect, say hello, push one stats frame, leave.
 */
const reportStats = (baseURL: string, secret: string): Promise<void> =>
  new Promise<void>((done, fail) => {
    const socket = new WebSocket(
      `${baseURL.replace(/^http/, "ws")}/ws/estates`,
      {
        headers: { authorization: `Bearer ${secret}` },
      },
    );
    const timer = setTimeout(
      () => fail(new Error("the fake machine never completed its handshake")),
      20_000,
    );
    socket.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    socket.on("open", () => socket.send(JSON.stringify({ type: "hello" })));
    socket.on("message", (raw) => {
      const text = Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString("utf8")
          : Buffer.from(raw as ArrayBuffer).toString("utf8");
      if ((JSON.parse(text) as { type?: string }).type !== "welcome") return;
      socket.send(
        JSON.stringify({
          type: "stats",
          cpuPercent: 12,
          memoryPercent: 81,
          at: new Date().toISOString(),
        }),
      );
      // A moment for the frame to land before the close is stamped.
      setTimeout(() => socket.close(), 500);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      done();
    });
  });

test.describe("Hosts with Ship off", () => {
  test("a Plan and Build project adds, connects, monitors and runs agent jobs on a host", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await registerAndVerify(
      page,
      `hosts-ship-off-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    // The wizard's defaults (Plan, Remember) and Build: no Ship.
    const project = await createProjectViaWizard(page, "Hosts Ship Off", {
      capabilities: ["build"],
    });

    // Settings > General > Hosts, and both kinds offered.
    await page.goto(`/${project.slug}/settings/hosts`);
    await expect(
      page.getByRole("link", { name: "Hosts", exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Add a host", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Create a new one", exact: true })
      .click();
    await expect(dialog.getByText("Bay", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Cloudflare", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    const { id: hostId, secret } = await createHostInProject(
      page,
      project.slug,
      "vps-ship-off",
    );

    // It connects and reports, then leaves.
    await reportStats(baseURL ?? "", secret);
    const host = await apiCall<{
      cpuPercent?: number;
      memoryPercent?: number;
      online: boolean;
    }>(page, "getHost", "GET", { hostId });
    expect(host.memoryPercent).toBe(81);
    expect(host.cpuPercent).toBe(12);
    expect(host.online).toBe(false);

    // The console, Ship off: Overview, Commands and Settings, no Processes.
    await page.goto(`/${project.slug}/hosts/vps-ship-off`);
    const tabs = page.getByTestId("bay-tabs");
    await expect(tabs.getByText("Overview")).toBeVisible({ timeout: 15_000 });
    await expect(tabs.getByText("Commands")).toBeVisible();
    await expect(tabs.getByText("Processes")).toHaveCount(0);

    // An Agent host, the project's default: its check is a job.
    await apiCall(
      page,
      "updateHost",
      "PATCH",
      { hostId },
      { jobsAllowed: true },
    );
    await apiCall(page, "updateHost", "PATCH", { hostId }, { agentHost: true });
    await apiCall(
      page,
      "setProjectAgentHost",
      "PUT",
      { projectId: project.id },
      { hostId },
    );
    const jobs = await apiCall<{ items: Array<{ id: string }> }>(
      page,
      "listProjectJobs",
      "GET",
      { projectId: project.id },
    );
    expect(jobs.items.length).toBeGreaterThan(0);

    // The job page answers, not a 404.
    const response = await page.goto(
      `/${project.slug}/jobs/${jobs.items[0]!.id}`,
    );
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Page not found")).toHaveCount(0);
  });
});
