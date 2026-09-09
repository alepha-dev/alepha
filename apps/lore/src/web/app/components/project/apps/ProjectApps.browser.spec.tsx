import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, it } from "vitest";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";

import { currentInstancesAtom } from "../../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import { I18n } from "../../../services/I18n.ts";
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
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {},
      {
        get: () => {
          const fn: any = async () => ({});
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

  // ⚠️ `AlephaTable` persists its filters, so a case would otherwise inherit
  // the previous one's selection and narrow a table it never touched.
  afterEach(() => {
    localStorage.clear();
  });

  const mount = async (
    instances: AppInstanceResource[] | undefined,
    { owner = true }: { owner?: boolean } = {},
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
        ? aProject
        : projectFixture({
            title: "Alepha",
            slug: "alepha",
            permissions: ["project:read", "app:read"],
            rank: { key: "member", name: "Member" },
          })) as never,
    );
    alepha.store.set(currentProjectMemberAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000001",
      projectId: 1,
      owner,
    } as never);
    alepha.store.set(currentInstancesAtom, instances as never);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectApps />
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
      anInstance("club", "production"),
      anInstance("club", "b14-production"),
      anInstance("lore", "production"),
    ]);

    await waitFor(() => expect(rowText(view)).toHaveLength(3));
    expect(rowText(view).filter((text) => text.includes("club"))).toHaveLength(
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
      anInstance("club", "production"),
      anInstance("club", "staging", withSigil(agoHours(1))),
      anInstance("club", "old", withSigil(agoHours(24 * 8))),
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
    const { view } = await mount([anInstance("club", "production")]);

    await waitFor(() => expect(rowText(view)).toHaveLength(1));
    const dot = view.container.querySelector("[role=img][data-state]")!;
    expect(dot.getAttribute("aria-label")).toBe("No sigil, nothing reports");
    expect(dot.getAttribute("title")).toBe("No sigil, nothing reports");
  });

  it("filters on the env half as well as the app half", async ({ expect }) => {
    // What makes a tenant-ish substring find anything at all: the app is
    // called `club` and only the env carries `b14`.
    const { view } = await mount([
      anInstance("club", "production"),
      anInstance("club", "b14-production"),
      anInstance("lore", "production"),
    ]);

    await waitFor(() => expect(rowText(view)).toHaveLength(3));
    const search = view.container.querySelector<HTMLInputElement>(
      'input[aria-label="Search"]',
    )!;
    fireEvent.change(search, { target: { value: "b14" } });

    await waitFor(() => expect(rowText(view)).toHaveLength(1));
    expect(rowText(view)[0]).toContain("b14-production");
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
      anInstance("club", "production"),
    ];

    const pick = async (filter: string, option: string | RegExp) => {
      const trigger = screen.getByRole("combobox", { name: filter });
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      fireEvent.click(await screen.findByRole("option", { name: option }));
      return trigger;
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
      expect(rowText(view).some((text) => text.includes("club"))).toBe(true);
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
      // The built-in field matching would keep `clubhouse` for a pick of
      // `club`. A single select means equality, which is why `app` is
      // answered in the callback rather than left to the property pass.
      const { view } = await mount([
        anInstance("club", "production"),
        anInstance("clubhouse", "production"),
      ]);
      await waitFor(() => expect(rowText(view)).toHaveLength(2));

      await pick("App", "club");

      await waitFor(() => expect(rowText(view)).toHaveLength(1));
      expect(rowText(view)[0]).toContain("club");
      expect(rowText(view)[0]).not.toContain("clubhouse");
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
      ).toEqual(["api", "club"]);
      fireEvent.keyDown(list, { key: "Escape" });

      fireEvent.click(
        screen.getAllByRole("button", { name: "Clear selection" })[0]!,
      );

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

      await waitFor(() =>
        expect(screen.queryByRole("combobox", { name: "App" })).toBeNull(),
      );
      expect(
        screen.queryByRole("combobox", { name: "Environment" }),
      ).not.toBeNull();
      expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeNull();
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
        anInstance("club", "production", { url: "https://club.example.com" }),
      ]);

      const link = await waitFor(() => {
        const found = addressOf(view);
        expect(found).not.toBeNull();
        return found!;
      });
      expect(link.getAttribute("href")).toBe("https://club.example.com");
      // ⚠️ All three, and none of them decoration. `noopener` because
      // `_blank` otherwise hands `window.opener` to a page Lore does not
      // control; `nofollow` because a deployed copy is not an endorsement
      // Lore is making.
      expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    });

    /**
     * ⚠️ A row in this table navigates to the instance page
     * (`AlephaTable`'s `onRowClick`, which is React's own `onClick` on the
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
        anInstance("club", "production", { url: "https://club.example.com" }),
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
      fireEvent.click(view.container.querySelector("tbody td")!);
      await settled();
    });

    /**
     * ⚠️ Text, never a link with no href. A copy with no sigil never posts to
     * the ingest and neither does a Feedback-only app, so "not known yet" is
     * a real state rather than a missing value - and an anchor that goes
     * nowhere says the opposite.
     */
    it("leaves an unknown address as plain text", async ({ expect }) => {
      const { view } = await mount([anInstance("club", "production")]);

      await waitFor(() => expect(rowText(view)).toHaveLength(1));
      expect(addressOf(view)).toBeNull();
    });
  });
});
