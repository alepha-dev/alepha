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
  unmonitoredInstances,
} from "../src/web/app/components/project/uptime/instanceMonitors.ts";
import MonitorFormDialog from "../src/web/app/components/project/uptime/MonitorFormDialog.tsx";
import MonitorSuggestions from "../src/web/app/components/project/uptime/MonitorSuggestions.tsx";

/**
 * Answers `listMonitors` with the monitors a case sets, and records every call.
 */
class FakeLinkProvider extends LinkProvider {
  monitors: MonitorListItem[] = [];
  calls: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy({} as Record<string, unknown>, {
      get: (_target, name: string) =>
        Object.assign(
          async () => {
            this.calls.push(name);
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
    app: "club",
    env: "production",
    url: "https://club.example.test",
    ephemeral: false,
    ...over,
  }) as AppInstanceResource;

const aMonitor = (target: string): MonitorListItem =>
  monitorListItemSchema.parse({
    id: crypto.randomUUID(),
    version: 0,
    projectId: 1,
    createdAt: "2026-10-15T10:00:00Z",
    name: "Club",
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
      slug: "club",
      capabilities: ["apps"],
      options: { apps: { uptime, track: false } },
    }),
  );
  return { alepha, links: alepha.inject(FakeLinkProvider) };
};

describe("monitors matched to app instances", () => {
  it("matches an HTTP monitor on the same address, ignoring case and a trailing slash", ({
    expect,
  }) => {
    const instance = anInstance();
    const monitor = aMonitor("https://CLUB.example.test/");

    expect(monitorOfInstance(instance, [monitor])).toBe(monitor);
    expect(
      monitorOfInstance(instance, [aMonitor("https://other.example.test")]),
    ).toBeUndefined();
  });

  it("offers durable copies with an address and no monitor, prefilled from the instance", ({
    expect,
  }) => {
    const monitored = anInstance();
    const free = anInstance({ env: "staging", url: "https://s.example.test" });
    const preview = anInstance({
      env: "pr-12",
      url: "https://pr.example.test",
      ephemeral: true,
    });
    const nowhere = anInstance({ env: "local", url: undefined });

    expect(
      unmonitoredInstances(
        [monitored, free, preview, nowhere],
        [aMonitor("https://club.example.test")],
      ),
    ).toEqual([free]);
    expect(monitorPrefill(free)).toEqual({
      name: "club staging",
      target: "https://s.example.test",
    });
    expect(monitorPrefill(nowhere)).toBeUndefined();
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
            prefill={{ name: "club staging", target: "https://s.example.test" }}
            onClose={() => {}}
          />
        </AlephaContext.Provider>,
      );
      expect(
        ((await view.findByLabelText(/^Name/)) as HTMLInputElement).value,
      ).toBe("club staging");
      expect(
        (view.getByLabelText(/^Target/) as HTMLTextAreaElement).value,
      ).toBe("https://s.example.test");
    } finally {
      await alepha.stop();
    }
  });

  it("lists unmonitored apps on /uptime and hands the clicked one back", async ({
    expect,
  }) => {
    const { alepha } = await boot(true);
    const added: string[] = [];
    const instance = anInstance({ env: "staging" });
    try {
      const view = render(
        <AlephaContext.Provider value={alepha}>
          <MonitorSuggestions
            instances={[instance]}
            busy={false}
            onAdd={(it) => added.push(it.id)}
          />
        </AlephaContext.Provider>,
      );
      fireEvent.click(
        view.getByRole("button", { name: "Add a monitor for club staging" }),
      );
      expect(added).toEqual([instance.id]);
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
      ).toBe("https://club.example.test");
      cleanup();

      links.monitors = [aMonitor("https://club.example.test")];
      const monitored = render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboardUptime instance={anInstance()} />
        </AlephaContext.Provider>,
      );
      const link = await monitored.findByRole("link", { name: "Club" });
      expect(link.getAttribute("href")).toBe(
        `/club/uptime/${links.monitors[0]!.id}`,
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
