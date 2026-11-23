import { DialogProvider } from "@alepha/ui";
import type { AdminHostResource } from "@lore/core/schemas";
import { I18n } from "@lore/core/web";
import { DeployHostRoles } from "@lore/ship/web";
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

import AdminHostAssignDialog from "./AdminHostAssignDialog.tsx";
import AdminHostRenameDialog from "./AdminHostRenameDialog.tsx";
import { AdminHosts } from "./AdminHosts.tsx";

/**
 * Answers the admin's host and project lists, and records what was asked.
 */
class AdminLinks extends LinkProvider {
  public calls: Array<{ action: string; request: unknown }> = [];
  public rows: AdminHostResource[] = [];
  public refuseRename?: string;

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, action: string) =>
          Object.assign(
            async (request: unknown) => {
              this.calls.push({ action, request });
              if (action === "findHosts") {
                return {
                  content: this.rows,
                  page: {
                    number: 0,
                    size: 25,
                    totalElements: this.rows.length,
                  },
                };
              }
              if (action === "findProjects") {
                return {
                  content: [
                    { id: 3, title: "Other" },
                    { id: 9, title: "Shop" },
                  ],
                  page: { number: 0, size: 100, totalElements: 2 },
                };
              }
              if (action === "adminRenameHost") {
                if (this.refuseRename) throw new Error(this.refuseRename);
                const body = (request as { body: { slug: string } }).body;
                return { slug: body.slug };
              }
              if (action === "assignHost") {
                return { project: { id: 9, title: "Shop" }, loans: [] };
              }
              return {};
            },
            { can: () => true },
          ),
      },
    );
  }
}

const LOOSE: AdminHostResource = {
  id: "00000000-0000-4000-8000-0000000000e1",
  slug: "loose",
  type: "bay",
  // Every host has a home since #Q3627.
  project: { id: 2, title: "Ops" },
  online: false,
  deployAllowed: true,
  createdAt: "2026-09-01T10:00:00.000Z",
  creator: { id: "00000000-0000-4000-8000-0000000000d1", name: "Dan" },
  loans: [
    { id: 9, title: "Shop" },
    { id: 4, title: "Blog" },
  ],
};

/**
 * The admin's hosts page (#Q3281): every host, its home, who created it and
 * where it is lent, and the assign dialog that moves it, offering the project
 * of its oldest loan first.
 */
describe("AdminHosts", () => {
  beforeAll(() => {
    setupJsdomMocks();
  });

  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const boot = async () => {
    cleanup();
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: AdminLinks })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter)
      // Lore's catalogue: the state pill is the project Hosts tab's, which
      // reads it (#Q4047).
      .with(I18n)
      // The pills: core's roles and Ship's deploy (#E166).
      .with(DeployHostRoles);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    return alepha.inject(LinkProvider) as AdminLinks;
  };

  it("names a host's home, its creator and its loans", async ({ expect }) => {
    const links = await boot();
    links.rows = [LOOSE];
    render(
      <AlephaContext.Provider value={alepha!}>
        <DialogProvider>
          <AdminHosts />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("loose")).toBeTruthy());
    expect(screen.queryByText("No home")).toBeNull();
    expect(screen.getByText("Dan")).toBeTruthy();
    expect(screen.getByText("Shop, Blog")).toBeTruthy();
  });

  it("reads N/A for a cloudflare host's Last seen, never for a bay one (#Q3943)", async ({
    expect,
  }) => {
    const links = await boot();
    links.rows = [
      LOOSE,
      {
        ...LOOSE,
        id: "00000000-0000-4000-8000-0000000000e2",
        slug: "cf",
        type: "cloudflare",
        credentialStatus: "valid",
      } as AdminHostResource,
    ];
    render(
      <AlephaContext.Provider value={alepha!}>
        <DialogProvider>
          <AdminHosts />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("cf")).toBeTruthy());
    expect(
      screen.getAllByTestId("host-last-seen").map((it) => it.textContent),
    ).toEqual(["never", "N/A"]);
    // The type is a tag pill in its own hue (#Q4048): Bay blue,
    // Cloudflare orange.
    const types = screen.getAllByTestId("host-type");
    expect(types.map((it) => it.textContent)).toEqual(["bay", "cloudflare"]);
    expect(types[0].className).toContain("bg-blue-500/15");
    expect(types[1].className).toContain("bg-orange-500/15");
  });

  it("reads Last seen relative to now, the exact date on hover (#Q4050)", async ({
    expect,
  }) => {
    const links = await boot();
    links.rows = [
      { ...LOOSE, lastSeenAt: "2020-01-15T10:30:00.000Z" } as AdminHostResource,
    ];
    render(
      <AlephaContext.Provider value={alepha!}>
        <DialogProvider>
          <AdminHosts />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    const cell = await screen.findByTestId("host-last-seen");
    await waitFor(() => expect(cell.textContent).toMatch(/ago$/));
    expect(cell.querySelector("[title]")?.getAttribute("title")).toContain(
      "2020",
    );
  });

  it("says online or offline only, and lists capabilities as pills (#Q4010)", async ({
    expect,
  }) => {
    const links = await boot();
    links.rows = [
      LOOSE,
      {
        ...LOOSE,
        id: "00000000-0000-4000-8000-0000000000e3",
        slug: "watch",
        online: true,
        deployAllowed: false,
      },
      {
        ...LOOSE,
        id: "00000000-0000-4000-8000-0000000000e2",
        slug: "cf",
        type: "cloudflare",
        credentialStatus: "valid",
      } as AdminHostResource,
      {
        ...LOOSE,
        id: "00000000-0000-4000-8000-0000000000e4",
        slug: "cf-bad",
        type: "cloudflare",
        credentialStatus: "invalid",
      } as AdminHostResource,
    ];
    render(
      <AlephaContext.Provider value={alepha!}>
        <DialogProvider>
          <AdminHosts />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("cf-bad")).toBeTruthy());
    const states = screen.getAllByTestId("host-state");
    expect(states.map((it) => it.textContent)).toEqual([
      "offline",
      "online",
      "online",
      "offline",
    ]);
    // Each pill is the tint tag with a leading icon.
    for (const pill of [...states, ...screen.getAllByTestId("host-type")]) {
      expect(pill.querySelector("svg")).not.toBeNull();
    }
    expect(
      screen.getAllByTestId("host-capabilities").map((it) => it.textContent),
    ).toEqual(["statsdeploy", "stats", "deploy", "deploy"]);
    // No old badge words left.
    expect(
      screen.queryByText(/credential (in)?valid|stats only|deploys/),
    ).toBeNull();
  });

  /**
   * The admin's rename, as moderation (#Q3664): the dialog opens on the
   * host's names, sends both, and keeps a refusal in place.
   */
  it("renames a host from its current names, and shows a refusal in place", async ({
    expect,
  }) => {
    const links = await boot();
    let renamed = 0;
    const host = { ...LOOSE, label: "Loose box" };
    render(
      <AlephaContext.Provider value={alepha!}>
        <AdminHostRenameDialog
          host={host}
          onOpenChange={() => {}}
          onRenamed={() => {
            renamed += 1;
          }}
        />
      </AlephaContext.Provider>,
    );

    const slug = (await screen.findByTestId(
      "admin-host-rename-slug",
    )) as HTMLInputElement;
    expect(slug.value).toBe("loose");
    expect(
      (screen.getByTestId("admin-host-rename-label") as HTMLInputElement).value,
    ).toBe("Loose box");

    links.refuseRename = 'Shop already has a host named "taken"';
    fireEvent.change(slug, { target: { value: "taken" } });
    fireEvent.click(screen.getByTestId("admin-host-rename-submit"));
    expect(
      (await screen.findByTestId("admin-host-rename-error")).textContent,
    ).toContain("already has a host");
    expect(renamed).toBe(0);

    links.refuseRename = undefined;
    fireEvent.change(slug, { target: { value: "paris-1" } });
    fireEvent.click(screen.getByTestId("admin-host-rename-submit"));
    await waitFor(() => expect(renamed).toBe(1));
    const calls = links.calls.filter((it) => it.action === "adminRenameHost");
    expect(calls.at(-1)?.request).toEqual({
      params: { id: LOOSE.id },
      body: { slug: "paris-1", label: "Loose box" },
    });
  });

  it("preselects the project of the oldest loan, and assigns there", async ({
    expect,
  }) => {
    const links = await boot();
    let assigned = false;
    render(
      <AlephaContext.Provider value={alepha!}>
        <AdminHostAssignDialog
          host={LOOSE}
          onOpenChange={() => {}}
          onAssigned={() => {
            assigned = true;
          }}
        />
      </AlephaContext.Provider>,
    );

    const submit = await screen.findByTestId("admin-host-assign-submit");
    await waitFor(() =>
      expect((submit as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(submit);
    await waitFor(() => expect(assigned).toBe(true));
    const call = links.calls.find((it) => it.action === "assignHost");
    expect(call?.request).toEqual({
      params: { id: LOOSE.id },
      body: { projectId: 9 },
    });
  });
});
