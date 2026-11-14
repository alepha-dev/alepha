import { DialogProvider, Toaster } from "@alepha/ui";
import { projectFixture } from "@lore/core/testing";
import {
  currentProjectAtom,
  currentProjectMemberAtom,
  I18n,
} from "@lore/core/web";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha, AlephaError } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { AppInstanceResource } from "../../../../../api/schemas/appInstanceResourceSchema.ts";
import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import ProjectApps from "./ProjectApps.tsx";

class Routes {
  app = $page({
    name: "app",
    path: "/:projectSlug/apps/:app/:env",
    component: () => null,
  });
}

const aProject = projectFixture({ title: "Alepha", slug: "alepha" });

let seq = 0;
const anInstance = (
  app: string,
  env: string,
  over: Partial<AppInstanceResource> = {},
): AppInstanceResource =>
  ({
    id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    projectId: 1,
    app,
    env,
    ephemeral: false,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...over,
  }) as AppInstanceResource;

/**
 * Timestamps relative to the wall clock rather than pinned.
 *
 * The component reads `DateTimeProvider.nowMillis()`, and travelling the
 * container's clock to an absolute date is not what `travel` takes. An hour ago
 * and eight days ago are unambiguous on either side of a 24-hour threshold
 * however long the suite takes to run.
 */
const agoHours = (hours: number) =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const withSigil = (lastSeenAt?: string) => ({
  sigilId: "00000000-0000-4000-8000-0000000000a1",
  sigil: {
    id: "00000000-0000-4000-8000-0000000000a1",
    tokenPrefix: "sg_test_",
    kinds: ["beacon"],
    createdAt: "2026-08-01T10:00:00.000Z",
    ...(lastSeenAt ? { lastSeenAt } : {}),
  },
});

class FakeLinkProvider extends LinkProvider {
  /**
   * Every `deleteApp` asked for, as `app/env`.
   */
  deleted: string[] = [];

  /**
   * Copies `deleteApp` refuses unless `forget` is passed, as the server does
   * for a copy still running on its Bay (#Q3603).
   */
  running: string[] = [];

  /**
   * What `listMonitors` answers, once `releaseMonitors` lets it.
   */
  monitors: unknown[] = [];
  releaseMonitors: () => void = () => {};
  monitorsHeld = new Promise<void>((resolve) => {
    this.releaseMonitors = resolve;
  });

  /**
   * Every monitor whose detail the hover card asked for (#Q3598).
   */
  details: string[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, key: string) => {
          const fn: any =
            key === "listMonitors"
              ? async () => {
                  await this.monitorsHeld;
                  return { items: this.monitors };
                }
              : key === "getMonitorDetail"
                ? async (request: { params: { monitorId: string } }) => {
                    this.details.push(request.params.monitorId);
                    return {
                      incidents: [
                        {
                          id: "00000000-0000-4000-8000-0000000000i1",
                          startedAt: "2026-11-10T08:00:00.000Z",
                          endedAt: "2026-11-10T08:05:00.000Z",
                          durationSecs: 300,
                          cause: "timeout",
                        },
                      ],
                    };
                  }
                : key === "deleteApp"
                  ? async (request: {
                      params: { app: string; env: string };
                      body?: { forget?: boolean };
                    }) => {
                      const copy = `${request.params.app}/${request.params.env}`;
                      if (this.running.includes(copy) && !request.body?.forget)
                        throw new AlephaError(
                          `${copy} still runs on its Bay. Remove it from the machine first (\`lore apps destroy\`), or pass \`forget\` to delete this copy and leave it running.`,
                        );
                      this.deleted.push(copy);
                      return { ok: true };
                    }
                  : async () => ({});
          fn.can = () => true;
          return fn;
        },
      },
    );
  }
}

describe("the Apps list", () => {
  // Base UI measures its popup before it opens one, and jsdom ships no
  // ResizeObserver. Without this the three select filters never render an
  // option list.
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  // ⚠️ `DataTable` persists its filters, so a case would otherwise inherit
  // the previous one's selection and narrow a table it never touched.
  afterEach(() => {
    localStorage.clear();
  });

  const mount = async (
    instances: AppInstanceResource[] | undefined,
    { owner = true, uptime = true }: { owner?: boolean; uptime?: boolean } = {},
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before anything that instantiates it: a substitution after that is
      // too late.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(I18n);
    alepha.inject(Routes);
    await alepha.start();

    // ⚠️ "A plain member" is a PERMISSION SET now, not a boolean on the
    // membership row: every write control in the project UI asks
    // `useRank().can(...)`, which reads the effective set the server computed.
    alepha.store.set(
      currentProjectAtom,
      (owner
        ? uptime
          ? aProject
          : projectFixture({
              title: "Alepha",
              slug: "alepha",
              options: { apps: { uptime: false } },
            })
        : projectFixture({
            title: "Alepha",
            slug: "alepha",
            permissions: ["project:read", "app:read"],
            rank: { key: "member", name: "Member" },
          })) as never,
    );
    alepha.store.set(currentProjectMemberAtom, {
      id: "00000000-0000-4000-8000-000000000003",
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000001",
      organizationId: aProject.organizationId,
      rank: owner ? "owner" : "member",
    } as never);
    alepha.store.set(currentInstancesAtom, instances as never);

    // The app's layout mounts the dialog provider the delete confirm uses.
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <Toaster />
          <ProjectApps />
        </DialogProvider>
      </AlephaContext.Provider>,
    );

    return { alepha, view };
  };

  const rowText = (view: { container: HTMLElement }) =>
    [...view.container.querySelectorAll("tbody tr")].map(
      (row) => row.textContent ?? "",
    );

  it("repeats the app name rather than blank-filling it", async ({
    expect,
  }) => {
    // A blank cell breaks sorting on every other column, and sorting is most
    // of what a flat list is for.
    const { view } = await mount([
      anInstance("acme", "production"),
      anInstance("acme", "east-production"),
      anInstance("lore", "production"),
    ]);

    await waitFor(() => expect(rowText(view)).toHaveLength(3));
    expect(rowText(view).filter((text) => text.includes("acme"))).toHaveLength(
      2,
    );
  });

  it("gives a sigil-less instance a hollow dot, never a silent one", async ({
    expect,
  }) => {
    // ⚠️ The case the old `isSilent` got wrong: no sigil means no
    // `lastSeenAt`, ever, so it rendered as silent forever - the UI reporting
    // a fault where there is a configuration.
    const { view } = await mount([
      anInstance("acme", "production"),
      anInstance("acme", "staging", withSigil(agoHours(1))),
      anInstance("acme", "old", withSigil(agoHours(24 * 8))),
    ]);

    await waitFor(() => expect(rowText(view)).toHaveLength(3));
    const states = [
      ...view.container.querySelectorAll("[role=img][data-state]"),
    ].map((dot) => dot.getAttribute("data-state"));
    expect(states).toEqual(["none", "reporting", "silent"]);
  });

  it("labels the dot for a reader, not only by colour", async ({ expect }) => {
    // Colour is the only carrier left since Reports and Last seen were cut,
    // and green against amber is the pair deuteranopia hits hardest.
    const { view } = await mount([anInstance("acme", "production")]);

    await waitFor(() => expect(rowText(view)).toHaveLength(1));
    const dot = view.container.querySelector("[role=img][data-state]")!;
    expect(dot.getAttribute("aria-label")).toBe("No sigil, nothing reports");
    expect(dot.getAttribute("title")).toBe("No sigil, nothing reports");
  });

  it("filters on the env half as well as the app half", async ({ expect }) => {
    // What makes a tenant-ish substring find anything at all: the app is
    // called `acme` and only the env carries `east`.
    const { view } = await mount([
      anInstance("acme", "production"),
      anInstance("acme", "east-production"),
      anInstance("lore", "production"),
    ]);

    await waitFor(() => expect(rowText(view)).toHaveLength(3));
    const search = view.container.querySelector<HTMLInputElement>(
      'input[aria-label="Search"]',
    )!;
    fireEvent.change(search, { target: { value: "east" } });

    await waitFor(() => expect(rowText(view)).toHaveLength(1));
    expect(rowText(view)[0]).toContain("east-production");
  });

  /**
   * From feedback #P2120: one search box is fine for four rows and useless
   * for forty. The two questions a reader asks of this table - which envs
   * does `api` have, which apps are in `production` - are not substring
   * searches.
   */
  describe("the app, env and status filters", () => {
    const A_FLEET = () => [
      anInstance("api", "production", withSigil(agoHours(1))),
      anInstance("api", "staging", withSigil(agoHours(24 * 8))),
      anInstance("acme", "production"),
    ];

    /**
     * The add menu, opened. Every filter here is optional, so it starts off
     * the bar (#E58) and is reached through this menu.
     */
    const openAddMenu = async () => {
      fireEvent.keyDown(screen.getByRole("button", { name: "Add filters" }), {
        key: "ArrowDown",
      });
      return screen.findByRole("menu");
    };

    /**
     * Pick one option of a filter: added from the menu when it is not on the
     * bar yet, which opens its list, or opened where it stands.
     */
    const pick = async (filter: string, option: string | RegExp) => {
      if (!screen.queryByRole("combobox", { name: filter })) {
        const menu = await openAddMenu();
        fireEvent.click(
          within(menu).getByRole("menuitem", {
            name: new RegExp(`^${filter}`),
          }),
        );
      } else {
        fireEvent.keyDown(screen.getByRole("combobox", { name: filter }), {
          key: "ArrowDown",
        });
      }
      fireEvent.click(await screen.findByRole("option", { name: option }));
      return screen.getByRole("combobox", { name: filter });
    };

    it("narrows to one app, keeping every env of it", async ({ expect }) => {
      const { view } = await mount(A_FLEET());
      await waitFor(() => expect(rowText(view)).toHaveLength(3));

      await pick("App", "api");

      await waitFor(() => expect(rowText(view)).toHaveLength(2));
      expect(rowText(view).every((text) => text.includes("api"))).toBe(true);
    });

    it("narrows to one env, keeping every app in it", async ({ expect }) => {
      const { view } = await mount(A_FLEET());
      await waitFor(() => expect(rowText(view)).toHaveLength(3));

      await pick("Environment", "production");

      await waitFor(() => expect(rowText(view)).toHaveLength(2));
      expect(rowText(view).some((text) => text.includes("acme"))).toBe(true);
      expect(rowText(view).some((text) => text.includes("staging"))).toBe(
        false,
      );
    });

    it("narrows on a status nothing carries as a property", async ({
      expect,
    }) => {
      // `status` is derived by `appLiveness`, so it can only ever be answered
      // by the filter callback.
      const { view } = await mount(A_FLEET());
      await waitFor(() => expect(rowText(view)).toHaveLength(3));

      // "Silent", not "Silent for over a day" (feedback #P2173): the filter
      // lists NAMES now, and the long form stayed on the liveness dot, where
      // it is the only place the threshold can be stated.
      await pick("Status", "Silent");

      await waitFor(() => expect(rowText(view)).toHaveLength(1));
      expect(rowText(view)[0]).toContain("staging");
    });

    it("matches an app exactly, never as a substring", async ({ expect }) => {
      // The built-in field matching would keep `acmeworks` for a pick of
      // `acme`. A single select means equality, which is why `app` is
      // answered in the callback rather than left to the property pass.
      const { view } = await mount([
        anInstance("acme", "production"),
        anInstance("acmeworks", "production"),
      ]);
      await waitFor(() => expect(rowText(view)).toHaveLength(2));

      await pick("App", "acme");

      await waitFor(() => expect(rowText(view)).toHaveLength(1));
      expect(rowText(view)[0]).toContain("acme");
      expect(rowText(view)[0]).not.toContain("acmeworks");
    });

    it("ANDs the filters, and clearing one widens without clearing the rest", async ({
      expect,
    }) => {
      const { view } = await mount(A_FLEET());
      await waitFor(() => expect(rowText(view)).toHaveLength(3));

      await pick("App", "api");
      await pick("Environment", "production");
      await waitFor(() => expect(rowText(view)).toHaveLength(1));

      // ⚠️ No "All apps" item (#Q1816): the list holds the real values and
      // nothing else, the empty trigger says "App", and the way back is the
      // `x` the trigger grows once something is chosen.
      const app = screen.getByRole("combobox", { name: "App" });
      fireEvent.keyDown(app, { key: "ArrowDown" });
      const list = await screen.findByRole("listbox");
      expect(
        within(list)
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["acme", "api"]);
      fireEvent.keyDown(list, { key: "Escape" });

      // The bar's own cross, which empties the filter and leaves it on the
      // bar; the select's in-field one is hidden inside the bar's box.
      fireEvent.click(screen.getByRole("button", { name: "Clear value: App" }));

      // Env survives: two apps are in production.
      await waitFor(() => expect(rowText(view)).toHaveLength(2));
    });

    it("hides a select whose only option matches every row", async ({
      expect,
    }) => {
      // One app across two envs: the App filter would offer a single value
      // that changes nothing. Status is always offered - its three values
      // exist whatever the data does.
      await mount([
        anInstance("api", "production"),
        anInstance("api", "staging"),
      ]);

      // Not on the bar, and not offered by the menu either: hidden is off
      // both.
      const menu = await openAddMenu();
      expect(within(menu).queryByRole("menuitem", { name: /^App/ })).toBeNull();
      expect(
        within(menu).queryByRole("menuitem", { name: /^Environment/ }),
      ).not.toBeNull();
      expect(
        within(menu).queryByRole("menuitem", { name: /^Status/ }),
      ).not.toBeNull();
      expect(screen.queryByRole("combobox", { name: "App" })).toBeNull();
    });
  });

  /**
   * Feedback #P2131: three columns on a 1920px screen while the row carries
   * more. The split is by what this list is FOR - it answers "what do we run
   * and where" - so identity and liveness are on and provenance is a click
   * away.
   */
  describe("the hidden columns", () => {
    const HIDDEN = ["Last seen", "Deploys to", "Created"];

    const headers = (view: { container: HTMLElement }) =>
      [...view.container.querySelectorAll("thead th")].map(
        (cell) => cell.textContent?.trim() ?? "",
      );

    it("starts on identity and liveness, with provenance off", async ({
      expect,
    }) => {
      const { view } = await mount([anInstance("api", "production")]);

      await waitFor(() => expect(rowText(view)).toHaveLength(1));
      const shown = headers(view);
      expect(shown).toEqual(
        expect.arrayContaining(["App", "Env", "Version", "Address"]),
      );
      for (const label of HIDDEN) {
        expect(shown).not.toContain(label);
      }
    });

    it("offers each of them in the column picker, and shows the value", async ({
      expect,
    }) => {
      // ⚠️ The value BEHIND the status dot, which is why it earns a column at
      // all: the dot says whether, this says when. There is deliberately no
      // Status column - that would render one fact twice.
      const { view } = await mount([
        anInstance("api", "production", withSigil(agoHours(1))),
      ]);
      await waitFor(() => expect(rowText(view)).toHaveLength(1));

      fireEvent.click(screen.getByRole("button", { name: "Toggle columns" }));
      for (const label of HIDDEN) {
        fireEvent.click(
          await screen.findByRole("menuitemcheckbox", { name: label }),
        );
      }

      await waitFor(() =>
        expect(headers(view)).toEqual(expect.arrayContaining(HIDDEN)),
      );
    });

    it("keeps a copy with no sigil out of the Last seen column, blank rather than dashed", async ({
      expect,
    }) => {
      // No sigil means it never reports, so there is no last time rather than
      // an unknown one.
      const { view } = await mount([anInstance("api", "production")]);
      await waitFor(() => expect(rowText(view)).toHaveLength(1));

      fireEvent.click(screen.getByRole("button", { name: "Toggle columns" }));
      fireEvent.click(
        await screen.findByRole("menuitemcheckbox", { name: "Last seen" }),
      );

      await waitFor(() => expect(headers(view)).toContain("Last seen"));
      expect(rowText(view)[0]).not.toContain("-");
    });
  });

  it("tells a failed read apart from an empty project", async ({ expect }) => {
    // ⚠️ They must not collapse into one falsy check: an empty state on a
    // transient failure claims a project has no apps. This page owns the
    // failed-read state now the sidebar's entry is gone.
    const failed = await mount(undefined);
    expect(failed.view.container.textContent).toContain("Couldn’t load apps");
    expect(failed.view.container.textContent).not.toContain("No app yet");

    const empty = await mount([]);
    await waitFor(() =>
      expect(empty.view.container.textContent).toContain("No app yet"),
    );
    expect(empty.view.container.textContent).not.toContain("Couldn’t load");
  });

  it("offers the create to an owner and not to a member", async ({
    expect,
  }) => {
    const asOwner = await mount([]);
    await waitFor(() =>
      expect(asOwner.view.container.textContent).toContain("New app"),
    );

    const asMember = await mount([], { owner: false });
    await waitFor(() =>
      expect(asMember.view.container.textContent).toContain("No app yet"),
    );
    expect(asMember.view.container.textContent).not.toContain("New app");
  });
  /**
   * The Address cell is the same external link the app's own header renders
   * (#P2161), which means it carries the same three `rel` tokens for the same
   * reason: the value is operator-supplied, or detected from a reporting
   * app's own `Host` header, so it is a third-party destination reached from
   * inside Lore's session.
   */
  describe("the Address cell", () => {
    const addressOf = (view: { container: HTMLElement }) =>
      view.container.querySelector(
        'tbody a[target="_blank"]',
      ) as HTMLAnchorElement | null;

    it("links the address out, with the opener and follow hints", async ({
      expect,
    }) => {
      const { view } = await mount([
        anInstance("acme", "production", { url: "https://acme.example.com" }),
      ]);

      const link = await waitFor(() => {
        const found = addressOf(view);
        expect(found).not.toBeNull();
        return found!;
      });
      expect(link.getAttribute("href")).toBe("https://acme.example.com");
      // ⚠️ All three, and none of them decoration. `noopener` because
      // `_blank` otherwise hands `window.opener` to a page Lore does not
      // control; `nofollow` because a deployed copy is not an endorsement
      // Lore is making.
      expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    });

    /**
     * ⚠️ A row in this table navigates to the instance page
     * (`DataTable`'s `onRowClick`, which is React's own `onClick` on the
     * `<tr>`). Without `stopPropagation` one click both opens the app in a
     * new tab AND moves the page underneath, so the reader comes back to
     * somewhere they never asked for.
     *
     * Written as a DIFFERENTIAL, because "the URL did not change" alone
     * would pass just as well if the row had stopped navigating entirely:
     * the second half proves the row still works. A native listener on the
     * `<tr>` cannot measure this - React delegates at the root, so a native
     * handler fires during bubbling whatever the synthetic event says.
     */
    it("does not navigate the row it sits in, while the row still does", async ({
      expect,
    }) => {
      const { alepha, view } = await mount([
        anInstance("acme", "production", { url: "https://acme.example.com" }),
      ]);

      const link = await waitFor(() => {
        const found = addressOf(view);
        expect(found).not.toBeNull();
        return found!;
      });

      // The router's live state, off the same store `useRouterState` reads.
      const routeName = () =>
        (alepha.store.get("alepha.react.router.state") as { name?: string })
          ?.name;
      const settled = () => waitFor(() => expect(routeName()).toBe("app"));

      // ⚠️ `await`ed, and asserted as a REJECTION rather than by reading the
      // route straight back. `onRowClick` calls `void router.push(...)`,
      // which is async: a synchronous read after the click sees the old
      // route whether or not the guard is there, so the first version of
      // this case passed with `stopPropagation` deleted. Measured, not
      // assumed - the deletion is what showed it.
      fireEvent.click(link);
      await expect(settled()).rejects.toThrow();

      // The same click one cell over DOES move the page, well inside the
      // window above. So the guard is narrow rather than a row that stopped
      // responding, and that window is generous rather than lucky.
      // The app's cell, not the first one: an owner's row starts with its
      // selection checkbox, whose click selects rather than opens (#Q3586).
      fireEvent.click(
        [...view.container.querySelectorAll("tbody td")].find(
          (cell) => cell.textContent === "acme",
        )!,
      );
      await settled();
    });

    /**
     * ⚠️ Text, never a link with no href. A copy with no sigil never posts to
     * the ingest and neither does a Feedback-only app, so "not known yet" is
     * a real state rather than a missing value - and an anchor that goes
     * nowhere says the opposite.
     */
    it("leaves an unknown address as plain text", async ({ expect }) => {
      const { view } = await mount([anInstance("acme", "production")]);

      await waitFor(() => expect(rowText(view)).toHaveLength(1));
      expect(addressOf(view)).toBeNull();
    });
  });

  /**
   * Delete from the list (#Q3586): a row's menu, or the selection's bar.
   * The confirm names what goes, and the app whose last environment it is.
   */
  describe("delete", () => {
    it("deletes one copy from its row menu, after a confirm naming its last-environment app", async ({
      expect,
    }) => {
      const { alepha, view } = await mount([
        anInstance("api", "production", withSigil(agoHours(1))),
        anInstance("acme", "production"),
        anInstance("acme", "staging"),
      ]);
      const fake = alepha.inject(FakeLinkProvider);

      const row = [...view.container.querySelectorAll("tbody tr")].find((it) =>
        it.textContent?.includes("api"),
      )!;
      fireEvent.click(
        within(row as HTMLElement).getByRole("button", {
          name: "Open row actions",
        }),
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));

      const confirm = await screen.findByRole("alertdialog");
      expect(confirm.textContent).toContain("Delete api/production?");
      expect(confirm.textContent).toContain("A sigil goes too");
      expect(confirm.textContent).toContain("last environment of api");
      fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(fake.deleted).toEqual(["api/production"]));
      await waitFor(() =>
        expect(rowText(view).some((text) => text.includes("api"))).toBe(false),
      );
    });

    it("deletes the selected copies in bulk", async ({ expect }) => {
      const { alepha, view } = await mount([
        anInstance("acme", "production"),
        anInstance("acme", "staging"),
        anInstance("lore", "production"),
      ]);
      const fake = alepha.inject(FakeLinkProvider);

      for (const row of [...view.container.querySelectorAll("tbody tr")].filter(
        (it) => it.textContent?.includes("acme"),
      ))
        fireEvent.click(within(row as HTMLElement).getByRole("checkbox"));
      fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

      const confirm = await screen.findByRole("alertdialog");
      expect(confirm.textContent).toContain("Delete 2 apps?");
      expect(confirm.textContent).toContain("last environment of acme");
      fireEvent.click(
        within(confirm).getByRole("button", { name: "Delete 2 apps" }),
      );

      await waitFor(() =>
        expect(fake.deleted.sort()).toEqual([
          "acme/production",
          "acme/staging",
        ]),
      );
    });

    it("shows each refused copy's reason, says deleted, and offers to delete it anyway", async ({
      expect,
    }) => {
      const { alepha, view } = await mount([
        anInstance("acme", "production"),
        anInstance("acme", "staging"),
        anInstance("lore", "production"),
      ]);
      const fake = alepha.inject(FakeLinkProvider);
      fake.running = ["acme/staging"];

      for (const row of [...view.container.querySelectorAll("tbody tr")].filter(
        (it) => it.textContent?.includes("acme"),
      ))
        fireEvent.click(within(row as HTMLElement).getByRole("checkbox"));
      fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Delete 2 apps",
        }),
      );

      // The refusal in the server's own words, not a count.
      const refused = await screen.findByRole("alertdialog", {
        name: "1 not deleted",
      });
      expect(refused.textContent).toContain(
        "acme/staging still runs on its Bay.",
      );
      expect(refused.textContent).toContain("lore apps destroy");
      expect(fake.deleted).toEqual(["acme/production"]);
      expect(document.body.textContent).toContain("1 could not be deleted.");
      expect(document.body.textContent).not.toContain("could not be updated");

      fireEvent.click(
        within(refused).getByRole("button", {
          name: "Delete and leave running",
        }),
      );
      await waitFor(() =>
        expect(fake.deleted.sort()).toEqual([
          "acme/production",
          "acme/staging",
        ]),
      );
      await waitFor(() =>
        expect(rowText(view).some((text) => text.includes("acme"))).toBe(false),
      );
    });

    it("offers no delete to a reader who may not manage apps", async ({
      expect,
    }) => {
      const { view } = await mount([anInstance("acme", "production")], {
        owner: false,
      });

      expect(
        view.container.querySelector(
          'tbody input[type="checkbox"], tbody [role="checkbox"]',
        ),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Open row actions" }),
      ).toBeNull();
    });
  });

  /**
   * The Uptime column (#Q3587): each copy's uptime from its HTTP monitor,
   * loaded after the table, a dash with no monitor, and absent with the
   * uptime option off.
   */
  describe("the Uptime column", () => {
    const watched = () =>
      anInstance("acme", "production", { url: "https://acme.example.com" });

    it("shows a placeholder until the monitors load, then each copy's uptime or a dash", async ({
      expect,
    }) => {
      const { alepha, view } = await mount([
        watched(),
        anInstance("lore", "production", { url: "https://lore.example.com" }),
      ]);
      const fake = alepha.inject(FakeLinkProvider);

      // The rows are there before the monitors are.
      expect(rowText(view)).toHaveLength(2);
      expect(screen.getByRole("columnheader", { name: "Uptime" })).toBeTruthy();
      await waitFor(() =>
        expect(screen.getAllByTestId("apps-uptime-loading")).toHaveLength(2),
      );

      fake.monitors = [
        {
          id: "00000000-0000-4000-8000-0000000000m1",
          kind: "http",
          target: "https://acme.example.com/",
          uptimePct: 99.5,
          beats: [],
        },
      ];
      fake.releaseMonitors();

      await waitFor(() =>
        expect(screen.queryAllByTestId("apps-uptime-loading")).toHaveLength(0),
      );
      const acme = rowText(view).find((text) => text.includes("acme"))!;
      const lore = rowText(view).find((text) => text.includes("lore"))!;
      expect(acme).toContain("99.5%");
      expect(lore).toMatch(/-$/);
    });

    it("draws the recent checks as a beat bar and tells more on hover, reading the detail only then", async ({
      expect,
    }) => {
      const { alepha } = await mount([watched()]);
      const fake = alepha.inject(FakeLinkProvider);
      const beat = (id: number, ok: boolean) => ({
        id: `00000000-0000-4000-8000-00000000000${id}`,
        monitorId: "00000000-0000-4000-8000-0000000000m1",
        at: `2026-11-13T10:0${id}:00.000Z`,
        ok,
        latencyMs: 40,
      });
      fake.monitors = [
        {
          id: "00000000-0000-4000-8000-0000000000m1",
          kind: "http",
          target: "https://acme.example.com/",
          active: true,
          status: "up",
          statusSince: "2026-11-13T10:02:00.000Z",
          lastLatencyMs: 42,
          uptimePct: 66.67,
          beats: [beat(1, true), beat(2, false), beat(3, true)],
        },
      ];
      fake.releaseMonitors();

      const cell = await screen.findByTestId("apps-uptime-cell");
      const bar = cell.querySelector('[aria-label="Recent checks"]')!;
      expect(bar.children).toHaveLength(3);
      expect(bar.querySelectorAll(".bg-red-500\\/80")).toHaveLength(1);
      expect(bar.querySelectorAll(".bg-emerald-500\\/80")).toHaveLength(2);
      expect(cell.textContent).toContain("66.67%");
      // Still lazy: nothing is read for the card until it opens.
      expect(fake.details).toEqual([]);

      fireEvent.mouseEnter(cell);
      fireEvent.pointerEnter(cell);
      fireEvent.focus(cell);
      const incident = await screen.findByTestId(
        "apps-uptime-last-incident",
        {},
        { timeout: 3000 },
      );
      await waitFor(() => expect(incident.textContent).toContain("timeout"));
      expect(fake.details).toEqual(["00000000-0000-4000-8000-0000000000m1"]);
      const card = incident.closest("dl")!;
      expect(card.textContent).toContain("24 hours");
      expect(card.textContent).toContain("Up");
      expect(card.textContent).toContain("42 ms");
    });

    it("is absent, and asks for nothing, with the uptime option off", async ({
      expect,
    }) => {
      const { view } = await mount([watched()], { uptime: false });

      expect(rowText(view)).toHaveLength(1);
      expect(screen.queryByRole("columnheader", { name: "Uptime" })).toBeNull();
      expect(screen.queryByTestId("apps-uptime-loading")).toBeNull();
    });
  });
});
