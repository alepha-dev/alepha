import { DialogProvider } from "@alepha/ui";
import type { AdminHostResource } from "@lore/deploy/schemas";
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
import { AlephaReactI18n } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, it } from "vitest";

import AdminHostAssignDialog from "./AdminHostAssignDialog.tsx";
import { AdminHosts } from "./AdminHosts.tsx";

/**
 * Answers the admin's host and project lists, and records what was asked.
 */
class AdminLinks extends LinkProvider {
  public calls: Array<{ action: string; request: unknown }> = [];
  public rows: AdminHostResource[] = [];

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

const HOMELESS: AdminHostResource = {
  id: "00000000-0000-4000-8000-0000000000e1",
  slug: "loose",
  type: "bay",
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
 * The admin's hosts page (#Q3281): where a host the migration could not
 * home gets one. Its row says it has no home, who created it and where it is
 * lent, and the assign dialog offers the project of its oldest loan first.
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
      .with(AlephaReactRouter);
    await alepha.start();
    return alepha.inject(LinkProvider) as AdminLinks;
  };

  it("names a homeless host's creator and its loans, and says it has no home", async ({
    expect,
  }) => {
    const links = await boot();
    links.rows = [HOMELESS];
    render(
      <AlephaContext.Provider value={alepha!}>
        <DialogProvider>
          <AdminHosts />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("loose")).toBeTruthy());
    expect(screen.getByText("No home")).toBeTruthy();
    expect(screen.getByText("Dan")).toBeTruthy();
    expect(screen.getByText("Shop, Blog")).toBeTruthy();
  });

  it("asks the server for the hosts with no home when the filter says so", async ({
    expect,
  }) => {
    // The filter as the table restores it: chosen once, persisted.
    window.localStorage.setItem(
      "lore.admin.hosts.filters",
      JSON.stringify({ home: ["none"] }),
    );
    const links = await boot();
    links.rows = [HOMELESS];
    render(
      <AlephaContext.Provider value={alepha!}>
        <DialogProvider>
          <AdminHosts />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("loose")).toBeTruthy());
    const fetched = links.calls.filter((it) => it.action === "findHosts");
    expect(
      (fetched.at(-1)!.request as { query: Record<string, unknown> }).query,
    ).toMatchObject({ homeless: true });
    window.localStorage.removeItem("lore.admin.hosts.filters");
  });

  it("preselects the project of the oldest loan, and assigns there", async ({
    expect,
  }) => {
    const links = await boot();
    let assigned = false;
    render(
      <AlephaContext.Provider value={alepha!}>
        <AdminHostAssignDialog
          host={HOMELESS}
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
      params: { id: HOMELESS.id },
      body: { projectId: 9 },
    });
  });
});
