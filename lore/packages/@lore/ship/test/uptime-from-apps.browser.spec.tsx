import { DialogProvider } from "@alepha/ui";
import { projectFixture } from "@lore/core/testing";
import { currentProjectAtom, I18n } from "@lore/core/web";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { AppInstanceResource } from "../src/api/schemas/appInstanceResourceSchema.ts";
import {
  type MonitorListItem,
  monitorListItemSchema,
} from "../src/api/schemas/monitorListItemSchema.ts";
import { currentInstanceAtom } from "../src/web/app/atoms/currentInstanceAtom.ts";
import AppDashboardUptime from "../src/web/app/components/project/apps/AppDashboardUptime.tsx";
import AppSettingsMonitor from "../src/web/app/components/project/apps/AppSettingsMonitor.tsx";
import { monitorOfInstance } from "../src/web/app/components/project/uptime/instanceMonitors.ts";

/**
 * Answers `listMonitors` with the monitors a case sets, and records every call.
 */
class FakeLinkProvider extends LinkProvider {
  monitors: MonitorListItem[] = [];
  sockets = true;
  calls: string[] = [];
  bodies: Record<string, unknown>[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name: string) =>
        Object.assign(
          async (args?: { body?: Record<string, unknown> }) => {
            this.calls.push(name);
            if (args?.body) this.bodies.push({ action: name, ...args.body });
            return name === "listMonitors"
              ? {
                  items: this.monitors,
                  estimated: false,
                  sockets: this.sockets,
                }
              : {};
          },
          { can: () => true },
        ),
    });
  }
}

const anInstance = (
  over: Partial<AppInstanceResource> = {},
): AppInstanceResource =>
  ({
    id: crypto.randomUUID(),
    createdAt: "2026-10-15T10:00:00Z",
    updatedAt: "2026-10-15T10:00:00Z",
    projectId: 1,
    app: "acme",
    env: "production",
    url: "https://acme.example.test",
    ephemeral: false,
    ...over,
  }) as AppInstanceResource;

const aMonitor = (
  target: string,
  appInstanceId?: string,
  over: Partial<MonitorListItem> = {},
): MonitorListItem =>
  monitorListItemSchema.parse({
    id: crypto.randomUUID(),
    version: 0,
    projectId: 1,
    appInstanceId,
    createdAt: "2026-10-15T10:00:00Z",
    name: "Acme",
    kind: "http",
    target,
    intervalSecs: 60,
    timeoutSecs: 10,
    confirmations: 2,
    graceSecs: 1500,
    expect: {},
    notifications: { email: true, recipients: [] },
    active: true,
    status: "up",
    statusSince: "2026-10-15T10:00:00Z",
    failures: 0,
    nextCheckAt: "2026-10-15T10:01:00Z",
    uptimePct: 99.5,
    beats: [],
    ...over,
  });

const boot = async (uptime: boolean) => {
  const alepha = Alepha.create()
    .with(AlephaReact)
    .with(AlephaReactI18n)
    .with(I18n)
    .with({ provide: LinkProvider, use: FakeLinkProvider });
  await alepha.start();
  await alepha.inject(I18nProvider).setLang("en");
  alepha.store.set(
    currentProjectAtom,
    projectFixture({
      slug: "acme",
      capabilities: ["ship"],
      options: { ship: { uptime, track: false } },
    }),
  );
  return { alepha, links: alepha.inject(FakeLinkProvider) };
};

describe("monitors owned by app copies", () => {
  it("finds the copy's monitor by the stored link, not by its address", ({
    expect,
  }) => {
    const instance = anInstance();
    const owned = aMonitor("https://elsewhere.example.test", instance.id);
    // Same address, another owner: not this copy's check.
    const sameAddress = aMonitor(
      "https://acme.example.test",
      crypto.randomUUID(),
    );

    expect(monitorOfInstance(instance, [sameAddress, owned])).toBe(owned);
    expect(monitorOfInstance(instance, [sameAddress])).toBeUndefined();
  });

  it("prefers the copy's HTTP check, the one its Monitor switch manages", ({
    expect,
  }) => {
    const instance = anInstance();
    const push = aMonitor("", instance.id, { kind: "push" });
    const http = aMonitor("https://acme.example.test", instance.id);
    expect(monitorOfInstance(instance, [push, http])).toBe(http);
    expect(monitorOfInstance(instance, [push])).toBe(push);
  });
});

describe("the Overview's Uptime card", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });
  afterEach(cleanup);

  it("summarises the copy's monitor while it is on, and offers no Add", async ({
    expect,
  }) => {
    const { alepha, links } = await boot(true);
    const instance = anInstance();
    try {
      links.monitors = [aMonitor("https://acme.example.test", instance.id)];
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboardUptime instance={instance} />
        </AlephaContext.Provider>,
      );
      const link = await view.findByRole("link", { name: "Acme" });
      // The app's Uptime tab (#Q3677), not the monitor's old page.
      expect(link.getAttribute("href")).toBe(
        `/acme/apps/${instance.app}/${instance.env}/uptime`,
      );
      expect(view.getByText("Up")).toBeTruthy();
      expect(view.queryByRole("button", { name: "Add monitor" })).toBeNull();
    } finally {
      await alepha.stop();
    }
  });

  it("is gone while Monitor is off (paused) or the copy has none", async ({
    expect,
  }) => {
    const { alepha, links } = await boot(true);
    const instance = anInstance();
    try {
      links.monitors = [
        aMonitor("https://acme.example.test", instance.id, {
          active: false,
          status: "paused",
        }),
      ];
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboardUptime instance={instance} />
        </AlephaContext.Provider>,
      );
      await waitFor(() => expect(links.calls).toContain("listMonitors"));
      expect(view.container.innerHTML).toBe("");
      expect(view.queryByRole("button", { name: "Add monitor" })).toBeNull();
    } finally {
      await alepha.stop();
    }
  });

  it("renders nothing and asks for nothing when the uptime option is off", async ({
    expect,
  }) => {
    const { alepha, links } = await boot(false);
    try {
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboardUptime instance={anInstance()} />
        </AlephaContext.Provider>,
      );
      await waitFor(() => expect(view.container.innerHTML).toBe(""));
      expect(links.calls).not.toContain("listMonitors");
    } finally {
      await alepha.stop();
    }
  });
});

/**
 * The Monitor section of app settings (#Q3684): one switch, needing the
 * address, that creates or resumes the copy's HTTP check.
 */
describe("app settings' Monitor", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });
  afterEach(cleanup);

  const mount = async (
    instance: ReturnType<typeof anInstance>,
    monitors: MonitorListItem[] = [],
    sockets = true,
  ) => {
    const { alepha, links } = await boot(true);
    links.monitors = monitors;
    links.sockets = sockets;
    alepha.store.set(currentInstanceAtom, instance as never);
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AppSettingsMonitor />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    const toggle = (await view.findByTestId(
      "app-monitor-toggle",
    )) as HTMLElement;
    // The list the section reads, before a case acts on the switch.
    await view.findByText("Monitor this app");
    return { alepha, links, view, toggle };
  };

  it("cannot be turned on without an address, and says so", async ({
    expect,
  }) => {
    const { alepha, view, toggle } = await mount(
      anInstance({ url: undefined }),
    );
    try {
      await waitFor(() =>
        expect(toggle.hasAttribute("data-disabled")).toBe(true),
      );
      expect(view.getByText(/Set the address above first/)).toBeTruthy();
    } finally {
      await alepha.stop();
    }
  });

  it("creates the copy's HTTP check on its address when switched on", async ({
    expect,
  }) => {
    const instance = anInstance();
    const { alepha, links, toggle } = await mount(instance);
    try {
      await waitFor(() =>
        expect(toggle.hasAttribute("data-disabled")).toBe(false),
      );
      expect(toggle.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(toggle);
      await waitFor(() =>
        expect(links.bodies).toContainEqual(
          expect.objectContaining({
            action: "createMonitor",
            appInstanceId: instance.id,
            kind: "http",
            target: "https://acme.example.test",
          }),
        ),
      );
    } finally {
      await alepha.stop();
    }
  });

  it("resumes a paused check, and shows its settings with Edit while on", async ({
    expect,
  }) => {
    const instance = anInstance();
    const paused = aMonitor("https://acme.example.test", instance.id, {
      active: false,
      status: "paused",
    });
    const { alepha, links, toggle } = await mount(instance, [paused]);
    try {
      await waitFor(() =>
        expect(toggle.hasAttribute("data-disabled")).toBe(false),
      );
      fireEvent.click(toggle);
      await waitFor(() =>
        expect(links.bodies).toContainEqual({
          action: "setMonitorActive",
          active: true,
        }),
      );
      expect(links.calls).not.toContain("createMonitor");
      cleanup();
      await alepha.stop();

      const on = await mount(instance, [
        aMonitor("https://acme.example.test", instance.id),
      ]);
      const summary = await on.view.findByTestId("app-monitor-summary");
      expect(summary.textContent).toContain("https://acme.example.test");
      expect(on.view.getByRole("button", { name: "Edit" })).toBeTruthy();
      await on.alepha.stop();
    } finally {
      await alepha.stop();
    }
  });

  it("explains, editing a TCP check, that a Lore without sockets cannot run it", async ({
    expect,
  }) => {
    const instance = anInstance({ url: undefined });
    const tcp = aMonitor("db.example.test:5432", instance.id, { kind: "tcp" });
    const reason =
      "TCP and certificate checks need a self-hosted Lore on Node, with socket support. This Lore has none, so it cannot run them.";
    const workers = await mount(instance, [tcp], false);
    try {
      fireEvent.click(
        await workers.view.findByRole("button", { name: "Edit" }),
      );
      expect(await workers.view.findByText(reason)).toBeTruthy();
    } finally {
      cleanup();
      await workers.alepha.stop();
    }
    const node = await mount(instance, [tcp]);
    try {
      fireEvent.click(await node.view.findByRole("button", { name: "Edit" }));
      expect(
        await node.view.findByText("Create a new monitor to change its kind."),
      ).toBeTruthy();
      expect(node.view.queryByText(reason)).toBeNull();
    } finally {
      await node.alepha.stop();
    }
  });
});
