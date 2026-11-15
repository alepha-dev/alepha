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
import AppDashboardUptime from "../src/web/app/components/project/apps/AppDashboardUptime.tsx";
import {
  monitorOfInstance,
  monitorPrefill,
} from "../src/web/app/components/project/uptime/instanceMonitors.ts";
import MonitorFormDialog from "../src/web/app/components/project/uptime/MonitorFormDialog.tsx";

/**
 * Answers `listMonitors` with the monitors a case sets, and records every call.
 */
class FakeLinkProvider extends LinkProvider {
  monitors: MonitorListItem[] = [];
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
              ? { items: this.monitors, estimated: false }
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

const aMonitor = (target: string, appInstanceId?: string): MonitorListItem =>
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
    expect: {},
    notifications: { email: true, recipients: [] },
    active: true,
    status: "up",
    statusSince: "2026-10-15T10:00:00Z",
    failures: 0,
    nextCheckAt: "2026-10-15T10:01:00Z",
    uptimePct: 99.5,
    beats: [],
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

  it("prefills a new monitor with the copy, its name and its address", ({
    expect,
  }) => {
    const free = anInstance({ env: "staging", url: "https://s.example.test" });
    const nowhere = anInstance({ env: "local", url: undefined });

    expect(monitorPrefill(free)).toEqual({
      appInstanceId: free.id,
      name: "acme staging",
      target: "https://s.example.test",
    });
    // A copy with no address still owns a push or a TCP check.
    expect(monitorPrefill(nowhere)).toEqual({
      appInstanceId: nowhere.id,
      name: "acme local",
      target: "",
    });
  });
});

describe("adding a monitor from an app", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });
  afterEach(cleanup);

  it("opens the dialog with the name and target filled in", async ({
    expect,
  }) => {
    const { alepha } = await boot(true);
    try {
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <MonitorFormDialog
            projectId={1}
            prefill={{
              appInstanceId: crypto.randomUUID(),
              name: "acme staging",
              target: "https://s.example.test",
            }}
            onClose={() => {}}
          />
        </AlephaContext.Provider>,
      );
      expect(
        ((await view.findByLabelText(/^Name/)) as HTMLInputElement).value,
      ).toBe("acme staging");
      expect(
        (view.getByLabelText(/^Target/) as HTMLTextAreaElement).value,
      ).toBe("https://s.example.test");
    } finally {
      await alepha.stop();
    }
  });

  it("shows the app's monitor on its page, or an Add monitor action", async ({
    expect,
  }) => {
    const { alepha, links } = await boot(true);
    const instance = anInstance();
    try {
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboardUptime instance={instance} />
        </AlephaContext.Provider>,
      );
      fireEvent.click(await view.findByRole("button", { name: "Add monitor" }));
      expect(
        ((await view.findByLabelText(/^Target/)) as HTMLTextAreaElement).value,
      ).toBe("https://acme.example.test");
      // Saving creates the monitor ON this copy (#Q3657).
      fireEvent.submit(view.getByLabelText(/^Target/).closest("form")!);
      await waitFor(() =>
        expect(links.bodies).toContainEqual(
          expect.objectContaining({
            action: "createMonitor",
            appInstanceId: instance.id,
          }),
        ),
      );
      cleanup();

      links.monitors = [aMonitor("https://acme.example.test", instance.id)];
      const monitored = render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboardUptime instance={instance} />
        </AlephaContext.Provider>,
      );
      const link = await monitored.findByRole("link", { name: "Acme" });
      expect(link.getAttribute("href")).toBe(
        `/acme/uptime/${links.monitors[0]!.id}`,
      );
      expect(monitored.getByText("Up")).toBeTruthy();
      expect(
        monitored.queryByRole("button", { name: "Add monitor" }),
      ).toBeNull();
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
