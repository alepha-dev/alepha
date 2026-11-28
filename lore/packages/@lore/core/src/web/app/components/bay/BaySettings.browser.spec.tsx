import { DialogProvider } from "@alepha/ui";
import { cleanup, render, screen } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { OwnedHostResource } from "../../../../api/schemas/ownedHostResourceSchema.ts";
import { currentHostAtom } from "../../atoms/currentHostAtom.ts";
import { HostConsoleRegistry } from "../../registries/HostConsoleRegistry.ts";
import { I18n } from "../../services/I18n.ts";
import BayAgent from "./BayAgent.tsx";
import BaySettings from "./BaySettings.tsx";

class QuietLinks extends LinkProvider {
  override client(): any {
    return new Proxy(
      {},
      {
        get: () =>
          Object.assign(async () => ({ items: [] }), { can: () => true }),
      },
    );
  }
}

class Routes {
  baySettings = $page({
    name: "baySettings",
    path: "/:projectSlug/hosts/:hostSlug/settings",
    component: () => null,
  });
  projectSettingsHosts = $page({
    name: "projectSettingsHosts",
    path: "/:projectSlug/settings/hosts",
    component: () => null,
  });
}

const host = (
  can: string[],
  extra: Partial<OwnedHostResource> = {},
): OwnedHostResource =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    slug: "ovh-1",
    type: "bay",
    online: true,
    overdue: false,
    deployAllowed: false,
    jobsAllowed: false,
    agentHost: false,
    collectSeries: false,
    statsIntervalSeconds: 1800,
    acceptedRuntimes: ["node"],
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    project: { id: 7, title: "Acme", slug: "acme" },
    creator: { id: "00000000-0000-4000-8000-0000000000c1", name: "Builder" },
    can,
    projects: [],
    ...extra,
  }) as OwnedHostResource;

/**
 * The console's Settings tab by rank (#Q3281): a plain Member of the home
 * project, who holds `host:read` only, reads a designed read-only page
 * saying which permission would let them act, and is offered no control.
 */
describe("BaySettings", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (
    can: string[],
    extra: Partial<OwnedHostResource> = {},
    Page: () => React.ReactNode = BaySettings,
    panels: (registry: HostConsoleRegistry) => void = () => {},
  ) => {
    cleanup();
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: QuietLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    // Read by the page for a module's panels (#E175), before the lock.
    panels(alepha.inject(HostConsoleRegistry));
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentHostAtom, host(can, extra));
    return render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Page />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  it("gives a reader a read-only page, with nothing to press", async ({
    expect,
  }) => {
    await show(["host:read"]);

    expect(screen.getByTestId("bay-settings-readonly").textContent).toContain(
      "host:update in Acme",
    );
    expect(screen.getByTestId("bay-settings-home").textContent).toContain(
      "Acme",
    );
    expect(screen.getByTestId("bay-settings-creator").textContent).toContain(
      "Builder",
    );
    expect(screen.queryByTestId("bay-settings-deploys")).toBeNull();
    expect(screen.queryByTestId("bay-settings-rotate")).toBeNull();
    expect(screen.queryByTestId("bay-settings-delete")).toBeNull();
    expect(screen.queryByTestId("bay-settings-move")).toBeNull();
  });

  it("shows the jobs user's tools: installed with a version, not installed, or another program (#Q4254)", async ({
    expect,
  }) => {
    await show(
      ["host:read"],
      {
        jobsUser: "bay-agent",
        jobsTools: [
          { name: "claude", kind: "agent", found: true, version: "2.1.7" },
          {
            name: "gh",
            kind: "tool",
            found: false,
            error: "gh is not on the jobs user's PATH",
          },
          {
            name: "cf",
            kind: "tool",
            found: true,
            error: "not Cloudflare's CLI: another program is installed as cf",
          },
          {
            name: "playwright-cli",
            kind: "tool",
            found: false,
            error: "playwright-cli is not on the jobs user's PATH",
          },
        ],
      },
      BayAgent,
    );
    expect(screen.getByTestId("bay-job-tools").textContent).toContain(
      "Jobs run as bay-agent.",
    );
    expect(screen.getByTestId("bay-job-tool-claude").textContent).toContain(
      "Installed, 2.1.7",
    );
    const gh = screen.getByTestId("bay-job-tool-gh");
    expect(gh.textContent).toContain("Not installed");
    expect(gh.querySelector("[title]")?.getAttribute("title")).toBe(
      "gh is not on the jobs user's PATH",
    );
    expect(screen.getByTestId("bay-job-tool-cf").textContent).toContain(
      "not Cloudflare's CLI",
    );
    // Optional (#Q4346): its absence says what a build job then skips.
    expect(
      screen.getByTestId("bay-job-tool-playwright-cli").textContent,
    ).toContain(
      "Not installed: optional, build jobs then make no visual check",
    );
  });

  it("shows each tool's sign-in, the command for a signed-out one, and warns on a signed-in lore (#Q4256)", async ({
    expect,
  }) => {
    await show(
      ["host:read"],
      {
        jobsUser: "bay-agent",
        jobsTools: [
          {
            name: "claude",
            kind: "agent",
            found: true,
            version: "2.1.7",
            signedIn: true,
            account: "ops@example.com",
          },
          { name: "gemini", kind: "agent", found: true, version: "0.9.0" },
          { name: "git", kind: "tool", found: true, version: "2.43.0" },
          {
            name: "gh",
            kind: "tool",
            found: true,
            version: "2.40.1",
            signedIn: false,
          },
          {
            name: "lore",
            kind: "tool",
            found: true,
            version: "0.38.0",
            signedIn: true,
          },
        ],
      },
      BayAgent,
    );
    expect(screen.getByTestId("bay-job-tool-claude").textContent).toContain(
      "signed in as ops@example.com",
    );
    expect(screen.getByTestId("bay-job-tool-gemini").textContent).toContain(
      "sign-in unknown",
    );
    expect(screen.getByTestId("bay-job-tool-git").textContent).not.toContain(
      "sign",
    );
    expect(screen.getByTestId("bay-job-tool-gh").textContent).toContain(
      "signed out: sudo -iu bay-agent gh auth login",
    );
    expect(
      screen.getByTestId("bay-job-tool-lore-warning").textContent,
    ).toContain("sudo -iu bay-agent lore logout");
  });

  it("says a signed-out gh is only needed for projects not connected to GitHub, on a Bay that runs job tokens (#Q4365)", async ({
    expect,
  }) => {
    await show(
      ["host:read"],
      {
        jobsUser: "bay-agent",
        jobsGitHubTokens: true,
        jobsTools: [
          {
            name: "gh",
            kind: "tool",
            found: true,
            version: "2.40.1",
            signedIn: false,
          },
        ],
      },
      BayAgent,
    );
    expect(screen.getByTestId("bay-job-tool-gh").textContent).toContain(
      "signed out: only needed for projects not connected to GitHub",
    );
    expect(screen.getByTestId("bay-job-tool-gh").textContent).not.toContain(
      "auth login",
    );
  });

  it("tells a host with no jobs user from one that never reported (#Q4254)", async ({
    expect,
  }) => {
    await show(["host:read"], { jobsUser: "" }, BayAgent);
    expect(screen.getByTestId("bay-job-tools-no-user").textContent).toContain(
      "bay config jobs --user <name>",
    );
    expect(screen.queryByTestId("bay-job-tools-never")).toBeNull();

    await show(["host:read"], {}, BayAgent);
    expect(screen.getByTestId("bay-job-tools-never")).toBeTruthy();
    expect(screen.queryByTestId("bay-job-tools-no-user")).toBeNull();
  });

  it("offers the switches and rotate under host:update, delete and move under host:delete", async ({
    expect,
  }) => {
    await show(["host:read", "host:update"]);
    expect(screen.queryByTestId("bay-settings-readonly")).toBeNull();
    expect(screen.getByTestId("bay-settings-deploys")).toBeTruthy();
    expect(screen.getByTestId("bay-settings-rotate")).toBeTruthy();
    expect(screen.queryByTestId("bay-settings-delete")).toBeNull();
    expect(screen.queryByTestId("bay-settings-move")).toBeNull();

    await show(["host:read", "host:update", "host:delete"]);
    expect(screen.getByTestId("bay-settings-delete")).toBeTruthy();
    expect(screen.getByTestId("bay-settings-move")).toBeTruthy();
  });

  it("draws the jobs user's tools and the registered agent panels on the Agent tab, and neither on Settings (#Q4414)", async ({
    expect,
  }) => {
    const panel = (registry: HostConsoleRegistry) =>
      registry.registerAgentPanel({
        key: "agent-host",
        order: 10,
        Component: (props: { canUpdate: boolean }) => (
          <div data-testid="spec-agent-panel">
            {props.canUpdate ? "can update" : "read only"}
          </div>
        ),
      });
    await show(["host:read", "host:update"], {}, BayAgent, panel);
    expect(screen.getByTestId("bay-job-tools")).toBeTruthy();
    expect(screen.getByTestId("spec-agent-panel").textContent).toBe(
      "can update",
    );

    await show(["host:read", "host:update"], {}, BaySettings, panel);
    expect(screen.queryByTestId("bay-job-tools")).toBeNull();
    expect(screen.queryByTestId("spec-agent-panel")).toBeNull();
    expect(screen.getByTestId("bay-settings-deploys")).toBeTruthy();
  });

  it("lists the Agent tab between Commands and Settings (#Q4414)", ({
    expect,
  }) => {
    const tabs = new HostConsoleRegistry().tabs(undefined);
    expect(tabs.map((it) => it.route)).toEqual([
      "bayOverview",
      "bayCommands",
      "bayStats",
      "bayAgent",
      "baySettings",
    ]);
    expect(tabs.find((it) => it.route === "bayAgent")?.labelKey).toBe(
      "bay.nav.agent",
    );
  });
});
