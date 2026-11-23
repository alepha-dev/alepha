import { DialogProvider } from "@alepha/ui";
import type { OwnedHostResource } from "@lore/core/schemas";
import { I18n } from "@lore/core/web";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import { currentHostAtom } from "../../atoms/currentHostAtom.ts";
import BayVersion from "./BayVersion.tsx";

/**
 * What the API answers, set by each case, and what the page asked of it.
 */
const world: {
  inventory: Record<string, unknown> | null;
  commands: Array<Record<string, unknown>>;
  enqueued: unknown[];
} = { inventory: null, commands: [], enqueued: [] };

class FakeLinks extends LinkProvider {
  override client(): any {
    const answers: Record<string, (input: any) => unknown> = {
      getHostInventory: () => ({ inventory: world.inventory, expected: [] }),
      listHostCommands: () => ({ items: world.commands }),
      enqueueHostCommand: (input) => {
        world.enqueued.push(input.body);
        return {
          id: "00000000-0000-4000-8000-0000000000aa",
          kind: "upgrade",
          status: "done",
          payload: { app: "", environment: "", version: input.body.version },
        };
      },
    };
    return new Proxy(
      {},
      {
        get: (_target, name: string) =>
          Object.assign(async (input: unknown) => answers[name]?.(input), {
            can: () => true,
          }),
      },
    );
  }
}

const host = (overrides: Partial<OwnedHostResource> = {}): OwnedHostResource =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    slug: "ovh-1",
    type: "bay",
    online: true,
    overdue: false,
    deployAllowed: true,
    jobsAllowed: false,
    agentHost: false,
    collectSeries: false,
    statsIntervalSeconds: 1800,
    acceptedRuntimes: ["node"],
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    lastSeenAt: "2026-11-17T10:00:00.000Z",
    project: { id: 7, title: "Acme", slug: "acme" },
    can: ["host:read", "host:update"],
    projects: [],
    ...overrides,
  }) as OwnedHostResource;

const inventory = (overrides: Record<string, unknown> = {}) => ({
  at: "2026-11-17T10:00:00.000Z",
  reportedAt: "2026-11-17T10:00:00.000Z",
  bayVersion: "0.39.0",
  upgradeMode: "handoff",
  targetBayVersion: "0.40.0",
  upgradeAvailable: true,
  upgradeByHand: false,
  machine: {},
  apps: [],
  ...overrides,
});

const BY_HAND =
  "curl -sSL https://alepha.dev/bay/install.sh | sudo BAY_VERSION=0.40.0 BAY_UPDATE_UNIT=yes sh";

/**
 * The version line of a Bay host's overview, one case per state (#E152).
 */
describe("BayVersion", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (
    openHost: OwnedHostResource,
    reported: Record<string, unknown> | null,
    commands: Array<Record<string, unknown>> = [],
  ) => {
    cleanup();
    world.inventory = reported;
    world.commands = commands;
    world.enqueued = [];
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentHostAtom, openHost);
    render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <BayVersion />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    // The inventory is a query: the line settles once it has answered.
    await waitFor(() => {
      if (
        reported &&
        screen.getByTestId("bay-version").querySelector("[data-state=unknown]")
      ) {
        throw new Error("still waiting for the inventory");
      }
    });
    return screen.getByTestId("bay-version");
  };

  const stateOf = (line: HTMLElement) =>
    line.querySelector("[data-state]")?.getAttribute("data-state");

  it("says the version, and nothing else, for a host that is current", async ({
    expect,
  }) => {
    const line = await show(
      host(),
      inventory({ bayVersion: "0.40.0", upgradeAvailable: false }),
    );
    expect(stateOf(line)).toBe("current");
    expect(line.textContent).toBe("Bay 0.40.0");
    expect(screen.queryByTestId("bay-version-upgrade")).toBeNull();
  });

  it("offers the upgrade, naming both versions, to who may update the host", async ({
    expect,
  }) => {
    const line = await show(host(), inventory());
    expect(stateOf(line)).toBe("upgradable");
    expect(line.textContent).toContain("Bay 0.39.0 → 0.40.0");
    const button = screen.getByTestId(
      "bay-version-upgrade",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByTestId("bay-version-blocked")).toBeNull();
  });

  it("shows a reader the two versions and no button", async ({ expect }) => {
    const line = await show(host({ can: ["host:read"] }), inventory());
    expect(line.textContent).toContain("Bay 0.39.0 → 0.40.0");
    expect(screen.queryByTestId("bay-version-upgrade")).toBeNull();
  });

  it("disables the button, with the reason, while the home project has deploys off", async ({
    expect,
  }) => {
    await show(host({ deployAllowed: false }), inventory());
    expect(
      (screen.getByTestId("bay-version-upgrade") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("bay-version-blocked").textContent).toBe(
      "Its home project has to allow deploys first.",
    );
  });

  it("disables the button, with the reason, while the host is offline", async ({
    expect,
  }) => {
    await show(host({ online: false }), inventory());
    expect(
      (screen.getByTestId("bay-version-upgrade") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("bay-version-blocked").textContent).toBe(
      "The host is offline.",
    );
  });

  it("gives no button to a host upgraded by hand: why, and the command to copy", async ({
    expect,
  }) => {
    for (const [upgradeMode, why] of [
      [undefined, "This Bay is too old to be upgraded from here."],
      ["restart", "Its systemd unit has no handoff drop-in"],
      ["manual", "This Bay does not run under systemd"],
    ] as const) {
      const line = await show(
        host(),
        inventory({ upgradeMode, upgradeByHand: true }),
      );
      expect(stateOf(line)).toBe("byHand");
      expect(line.textContent).toContain("Bay 0.39.0 → 0.40.0");
      expect(line.textContent).toContain(why);
      expect(screen.getByTestId("bay-version-command").textContent).toBe(
        BY_HAND,
      );
      expect(screen.queryByTestId("bay-version-upgrade")).toBeNull();
    }
  });

  it("says offline since the upgrade, with the command that puts the old version back", async ({
    expect,
  }) => {
    const line = await show(
      host({ online: false, lastSeenAt: "2026-11-17T10:00:30.000Z" }),
      // Still the old Bay's inventory: the new one never reported.
      inventory(),
      [
        {
          id: "00000000-0000-4000-8000-0000000000bb",
          kind: "upgrade",
          status: "done",
          finishedAt: "2026-11-17T10:00:20.000Z",
          payload: {
            app: "",
            environment: "",
            version: "0.40.0",
            fromVersion: "0.39.0",
          },
        },
      ],
    );
    await waitFor(() => {
      expect(stateOf(line)).toBe("offlineSinceUpgrade");
    });
    expect(line.textContent).toContain("Offline since the upgrade to 0.40.0");
    expect(screen.getByTestId("bay-version-command").textContent).toBe(
      "curl -sSL https://alepha.dev/bay/install.sh | sudo BAY_VERSION=0.39.0 sh",
    );
    // The same upgrade is not offered again to a machine that may be down
    // because of it.
    expect(screen.queryByTestId("bay-version-upgrade")).toBeNull();
  });

  it("does not blame an old upgrade for a host that went offline days later", async ({
    expect,
  }) => {
    const line = await show(
      host({ online: false, lastSeenAt: "2026-11-17T10:00:00.000Z" }),
      inventory(),
      [
        {
          id: "00000000-0000-4000-8000-0000000000cc",
          kind: "upgrade",
          status: "done",
          finishedAt: "2026-11-10T10:00:00.000Z",
          payload: { app: "", environment: "", version: "0.39.0" },
        },
      ],
    );
    expect(stateOf(line)).toBe("upgradable");
  });

  it("confirms with both versions and the restart-once caveat, then sends the target and says when it is done", async ({
    expect,
  }) => {
    await show(host(), inventory());

    fireEvent.click(screen.getByTestId("bay-version-upgrade"));
    const title = await screen.findByText("Upgrade Bay from 0.39.0 to 0.40.0?");
    expect(title).toBeTruthy();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("no request is refused");
    expect(dialog.textContent).toContain(
      "unless the new version changes how Bay builds their containers, in which case each restarts once",
    );
    expect(dialog.textContent).toContain("the current one keeps serving");
    // Nothing is sent until the dialog is confirmed.
    expect(world.enqueued).toEqual([]);

    const confirm = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Upgrade Bay"),
    );
    fireEvent.click(confirm!);

    await waitFor(() => {
      expect(world.enqueued).toEqual([{ kind: "upgrade", version: "0.40.0" }]);
    });
    await waitFor(() => {
      expect(screen.getByTestId("bay-version-progress").textContent).toBe(
        "Upgraded to 0.40.0.",
      );
    });
  });

  it("shows the progress of an upgrade already running when the page opens", async ({
    expect,
  }) => {
    await show(host(), inventory(), [
      {
        id: "00000000-0000-4000-8000-0000000000dd",
        kind: "upgrade",
        status: "running",
        step: "handing over",
        payload: { app: "", environment: "", version: "0.40.0" },
      },
    ]);
    await waitFor(() => {
      expect(screen.getByTestId("bay-version-progress").textContent).toBe(
        "Upgrading (handing over)…",
      );
    });
  });
});
