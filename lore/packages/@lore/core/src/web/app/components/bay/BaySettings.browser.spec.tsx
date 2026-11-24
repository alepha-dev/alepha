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
import { I18n } from "../../services/I18n.ts";
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
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentHostAtom, host(can, extra));
    return render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <BaySettings />
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
    await show(["host:read"], {
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
      ],
    });
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
  });

  it("tells a host with no jobs user from one that never reported (#Q4254)", async ({
    expect,
  }) => {
    await show(["host:read"], { jobsUser: "" });
    expect(screen.getByTestId("bay-job-tools-no-user").textContent).toContain(
      "bay config jobs --user <name>",
    );
    expect(screen.queryByTestId("bay-job-tools-never")).toBeNull();

    await show(["host:read"]);
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
});
