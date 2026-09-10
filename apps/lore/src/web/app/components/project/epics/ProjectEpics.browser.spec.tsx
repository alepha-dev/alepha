import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
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
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectEpics from "./ProjectEpics.tsx";

const epicOf = (
  number: number,
  title: string,
  status: EpicResource["status"],
  releaseId?: number,
): EpicResource =>
  ({
    id: number,
    number,
    projectId: 1,
    title,
    description: "",
    status,
    releaseId,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
  }) as unknown as EpicResource;

/**
 * Stands in for the HTTP-backed `useClient()` calls the list makes. Same
 * substitution seam as `ProjectQuestsTable.browser.spec.tsx`.
 */
class FakeLinkProvider extends LinkProvider {
  epics: EpicResource[] = [
    epicOf(1, "Planned epic", "planned"),
    epicOf(2, "Ready epic", "ready"),
    epicOf(3, "Started epic", "in_progress"),
    epicOf(4, "Completed epic", "completed"),
  ];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const action = <T extends (...args: any[]) => Promise<unknown>>(fn: T) =>
      Object.assign(fn, { can: () => true });
    return new Proxy(
      {
        getEpics: action(async () => [...this.epics]),
      } as Record<string, unknown>,
      {
        get: (target, prop: string) =>
          target[prop] ??
          action(async () => Object.assign([], { content: [], items: [] })),
      },
    );
  }
}

/**
 * The epic page, so the row anchors have something to resolve against.
 */
class Routes {
  epic = $page({
    name: "projectEpic",
    path: "/epics/:epicNumber",
    component: () => null,
  });
}

/**
 * The status filter takes several statuses (feedback #2069): everything
 * not started yet, say, used to be impossible with one value at a time. An
 * empty selection still means every status.
 */
describe("ProjectEpics - the status filter", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    // The table persists its filters per project; a test must not inherit
    // the previous one's selection.
    localStorage.clear();
  });

  const mount = async (
    releases: unknown[] = [],
    epics?: EpicResource[],
    project: unknown = projectFixture(),
  ) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, project as never);
    alepha.store.set(currentReleasesAtom, releases as never);
    // Injected AFTER `start` and before `render`, so a case can bring its own
    // fixture without a second provider class. The default set is what every
    // other case in this file relies on, so it is left alone unless asked.
    if (epics) alepha.inject(FakeLinkProvider).epics = epics;

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectEpics />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await view.findByRole("link", {
      name: `#E${(epics ?? [])[0]?.number ?? 1} - ${
        (epics ?? [])[0]?.title ?? "Planned epic"
      }`,
    });
    return view;
  };

  const row = (name: string) => screen.queryByRole("link", { name });

  it("shows every status while nothing is selected", async () => {
    await mount();

    expect(row("#E1 - Planned epic")).not.toBeNull();
    expect(row("#E2 - Ready epic")).not.toBeNull();
    expect(row("#E3 - Started epic")).not.toBeNull();
    expect(row("#E4 - Completed epic")).not.toBeNull();
  });

  it("keeps Planned and Ready when both are selected, and hides the rest", async () => {
    await mount();

    const status = screen.getByRole("combobox", { name: "Status" });
    fireEvent.keyDown(status, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /Planned/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Ready/ }));

    await waitFor(() => expect(row("#E4 - Completed epic")).toBeNull());
    expect(row("#E3 - Started epic")).toBeNull();
    expect(row("#E1 - Planned epic")).not.toBeNull();
    expect(row("#E2 - Ready epic")).not.toBeNull();
    // The trigger says how many, the way the Quests list's does.
    expect(status.textContent).toContain("2 status");
  });

  /**
   * The Release filter (feedback #2102): the Epics list could SHOW which
   * release an epic ships in, and sort by it, but not narrow by it - which
   * is the question anyone planning a release opens this page to ask.
   *
   * Two decisions are pinned here rather than left to the reader, because
   * the same page carries the opposite rule fifty lines away in the bulk
   * `Add to release` menu, and copying the wrong one is silent.
   */
  describe("the release filter", () => {
    // `currentReleasesAtom` is schema-validated, so a release here is the
    // whole row and not the three fields this describe reads.
    const aRelease = (id: number, tag: string, released?: string) => ({
      id,
      projectId: 1,
      number: id,
      tag,
      title: tag,
      description: "",
      releasedAt: released,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
    });

    const RELEASES = [
      aRelease(7, "0.28.0", "2026-09-03T00:00:00.000Z"),
      aRelease(8, "0.29.0"),
    ];

    const EPICS = [
      epicOf(1, "Shipped epic", "completed", 7),
      epicOf(2, "Next epic", "in_progress", 8),
      epicOf(3, "Unassigned epic", "planned"),
    ];

    const openFilter = async () => {
      const trigger = screen.getByRole("combobox", { name: "Release" });
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      return trigger;
    };

    it("is absent while the project has no release", async () => {
      await mount();

      // One value that matches everything is a control with nothing to do.
      expect(screen.queryByRole("combobox", { name: "Release" })).toBeNull();
    });

    it("narrows to the epics attached to the picked release", async () => {
      await mount(RELEASES, EPICS);

      await openFilter();
      fireEvent.click(await screen.findByRole("option", { name: "0.29.0" }));

      await waitFor(() => expect(row("#E1 - Shipped epic")).toBeNull());
      expect(row("#E2 - Next epic")).not.toBeNull();
      expect(row("#E3 - Unassigned epic")).toBeNull();
    });

    /**
     * ⚠️ The opposite of the bulk menu's rule, deliberately. A published
     * release is excluded THERE because attaching to one is refused server
     * side, so the entry could only ever fail. It is included HERE because a
     * filter reads history, and "what went into 0.28.0" is a question the
     * table has to be able to answer after 0.28.0 has shipped.
     */
    it("offers a published release, which the Add to release menu does not", async () => {
      await mount(RELEASES, EPICS);

      await openFilter();
      fireEvent.click(await screen.findByRole("option", { name: "0.28.0" }));

      await waitFor(() => expect(row("#E2 - Next epic")).toBeNull());
      expect(row("#E1 - Shipped epic")).not.toBeNull();
    });

    it("answers which epics are unassigned, through the No release entry", async () => {
      await mount(RELEASES, EPICS);

      await openFilter();
      fireEvent.click(
        await screen.findByRole("option", { name: "No release" }),
      );

      await waitFor(() => expect(row("#E1 - Shipped epic")).toBeNull());
      expect(row("#E2 - Next epic")).toBeNull();
      expect(row("#E3 - Unassigned epic")).not.toBeNull();
    });

    /**
     * The sentinel shares the list with the ids so that this is expressible
     * in one selection. Two fields would AND where a multi-select ORs.
     */
    it("ORs the sentinel with a release rather than ANDing them", async () => {
      await mount(RELEASES, EPICS);

      await openFilter();
      fireEvent.click(
        await screen.findByRole("option", { name: "No release" }),
      );
      fireEvent.click(await screen.findByRole("option", { name: "0.29.0" }));

      await waitFor(() => expect(row("#E1 - Shipped epic")).toBeNull());
      expect(row("#E2 - Next epic")).not.toBeNull();
      expect(row("#E3 - Unassigned epic")).not.toBeNull();
      // The trigger counts, the way its neighbour does.
      expect(
        screen.getByRole("combobox", { name: "Release" }).textContent,
      ).toContain("2 releases");
    });
  });

  /**
   * The selection bar (feedback #2086): two lists of the project's own work,
   * one of which could be operated on in bulk and one of which could not.
   */
  describe("the bulk actions", () => {
    const aRelease = (id: number, tag: string, released?: string) => ({
      id,
      projectId: 1,
      number: id,
      tag,
      title: tag,
      description: "",
      releasedAt: released,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
    });

    // Found through the row's own title anchor rather than the row's
    // accessible name: the rows carry equal `updatedAt`, so their order is
    // the sort's business and not this test's.
    const selectRow = (name: string) => {
      const row = screen.getByRole("link", { name }).closest("tr");
      expect(row).not.toBeNull();
      fireEvent.click(within(row!).getByRole("checkbox"));
    };

    it("reveals the actions once a row is selected, and not before", async () => {
      await mount();

      // The checkbox column only exists because `bulkActions` is non-empty,
      // so its presence is the first half of the assertion.
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

      selectRow("#E1 - Planned epic");

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Delete" })).not.toBeNull(),
      );
      expect(
        screen.getByRole("button", { name: /Add to release/ }),
      ).toBeTruthy();
    });

    it("leaves a published release out of the Add to release menu", async () => {
      await mount([
        aRelease(7, "0.28.0", "2026-09-03T13:47:42.849Z"),
        aRelease(8, "0.29.0"),
      ]);

      selectRow("#E1 - Planned epic");

      fireEvent.click(
        await screen.findByRole("button", { name: /Add to release/ }),
      );

      const items = await waitFor(() => {
        const found = document.querySelectorAll('[role="menuitem"]');
        if (found.length === 0) throw new Error("not open yet");
        return [...found].map((item) => item.textContent);
      });

      // `ReleaseAttachmentService.resolve` refuses a published release
      // server-side, so an entry for one could only ever fail.
      expect(items.join(" ")).toContain("0.29.0");
      expect(items.join(" ")).not.toContain("0.28.0");
    });
  });

  /**
   * Review (feedback #2087): the row action that puts an agent prompt on the
   * clipboard. The prompt's own text is pinned by
   * `prompts/epicReviewPrompt.spec.ts`; what is asserted here is the wiring
   * and the gate.
   */
  describe("the Review row action", () => {
    /**
     * A clipboard jsdom does not have. Assigned rather than mocked - the
     * same substitution the suite already does for `ResizeObserver`, and
     * the reason `vi.mock` is not needed for it.
     */
    const stubClipboard = () => {
      const written: string[] = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            written.push(text);
          },
        },
      });
      return written;
    };

    const openRowMenu = async (name: string) => {
      const row = screen.getByRole("link", { name }).closest("tr");
      expect(row).not.toBeNull();
      fireEvent.click(
        within(row!).getByRole("button", { name: "Open row actions" }),
      );
      return await waitFor(() => {
        const found = document.querySelectorAll('[role="menuitem"]');
        if (found.length === 0) throw new Error("not open yet");
        return [...found];
      });
    };

    /**
     * Open the row menu, then its Agent Prompts submenu, and answer the
     * entries INSIDE it.
     *
     * ⚠️ `openRowMenu` reads the top level only, where the group appears as
     * a single trigger. A case that kept asserting on `Review` against that
     * list would go red; one rewritten to assert "Agent Prompts" would pass
     * while proving nothing about the entries.
     *
     * The gesture is #Q1959's, measured rather than guessed: a plain
     * `fireEvent.click` on the trigger opens the submenu under jsdom, the
     * same gesture as the row menu itself, and the content is portalled so
     * the children are read off `document`.
     *
     * ⚠️ It takes the ALREADY-OPEN item list rather than a row name.
     * `openRowMenu` clicks the three-dots trigger, and clicking it a second
     * time toggles the menu shut, so a case that opened the row menu and
     * then called this with a name found an empty document.
     */
    const openAgentPrompts = async (items: Element[]) => {
      const trigger = items.find((item) =>
        item.textContent?.includes("Agent Prompts"),
      );
      if (!trigger) return [];
      fireEvent.click(trigger);
      return await waitFor(() => {
        const found = [...document.querySelectorAll('[role="menuitem"]')];
        const children = found.filter(
          (item) => !item.textContent?.includes("Agent Prompts"),
        );
        if (children.length === 0) throw new Error("submenu not open yet");
        return children;
      });
    };

    it("offers Review but not Work on it on a planned epic, beside Mark as ready", async () => {
      await mount();

      // The top level carries the group and Mark as ready. Review is one
      // level in, which is what the submenu changed.
      //
      // ⚠️ The row menu is opened ONCE and the list reused: the three-dots
      // trigger toggles, so opening it again to read the submenu closes it.
      const opened = await openRowMenu("#E1 - Planned epic");
      const top = opened.map((item) => item.textContent);
      expect(top.join(" ")).toContain("Agent Prompts");
      expect(top.join(" ")).toContain("Mark as ready");
      expect(top.join(" ")).not.toContain("Review");

      const inside = (await openAgentPrompts(opened)).map(
        (item) => item.textContent,
      );
      // The labels a quest and a feedback item use for the same acts
      // (feedback #P2182): "Review Epic", and "Work on it" for epicActivate.
      // The list also holds the row menu's own entries, hence contains.
      expect(inside).toContain("Review Epic");
      // A planned epic's quests refuse to be accepted, and whether its spec
      // is done is the owner's call, not the agent's (#Q2223).
      expect(inside).not.toContain("Work on it");
    });

    it("offers both on a ready epic, beside Back to planning", async () => {
      await mount();

      // Ready: the plan is still open, so Review stays, and its quests can
      // be accepted, so Work on it appears. Its first accept starts it.
      const opened = await openRowMenu("#E2 - Ready epic");
      const top = opened.map((item) => item.textContent);
      expect(top.join(" ")).toContain("Back to planning");
      expect(top.join(" ")).not.toContain("Mark as ready");

      const inside = (await openAgentPrompts(opened)).map(
        (item) => item.textContent,
      );
      expect(inside).toContain("Review Epic");
      expect(inside).toContain("Work on it");
    });

    it("drops Review Epic once the epic is in progress but keeps Work on it", async () => {
      await mount();

      // Reviewing a plan is a thing you do while the plan is still open;
      // once the epic has started the quest set is what is being worked.
      // Work on it stays, because a half-worked epic can still be handed
      // over, and no status move is offered: the rest happen on their own.
      const opened = await openRowMenu("#E3 - Started epic");
      const top = opened.map((item) => item.textContent);
      expect(top.join(" ")).toContain("Agent Prompts");
      expect(top.join(" ")).not.toContain("Mark as ready");
      expect(top.join(" ")).not.toContain("Back to planning");

      const inside = (await openAgentPrompts(opened)).map(
        (item) => item.textContent,
      );
      expect(inside).toContain("Work on it");
      expect(inside).not.toContain("Review Epic");
    });

    /**
     * ⚠️ The empty-group case. A completed epic passes neither gate, so the
     * group has no children, and #Q1959's effective-entry count is what
     * keeps it from rendering a trigger over an empty menu.
     */
    it("offers no group at all on a completed epic", async () => {
      await mount();

      const top = (await openRowMenu("#E4 - Completed epic")).map(
        (item) => item.textContent,
      );
      expect(top.join(" ")).not.toContain("Agent Prompts");
      expect(top.join(" ")).not.toContain("Review Epic");
      expect(top.join(" ")).not.toContain("Work on it");
    });

    /**
     * ⚠️ The dialog is gone, and with it the editing step (feedback #2097
     * is answered in Settings instead: the tweak was the same every time,
     * so it belongs in a template rather than in the clipboard). A click
     * copies, so the guarantee moves back onto `writeText`'s argument.
     */
    it("copies the prompt, carrying the epic, the URL and the calls that read it", async () => {
      const written = stubClipboard();
      await mount();

      const items = await openAgentPrompts(
        await openRowMenu("#E1 - Planned epic"),
      );
      const review = items.find((item) => item.textContent?.includes("Review"));
      expect(review).toBeTruthy();
      fireEvent.click(review!);

      await waitFor(() => expect(written).toHaveLength(1));
      const prompt = written[0];
      expect(prompt).toContain("#E1");
      expect(prompt).toContain("Planned epic");
      expect(prompt).toContain("/epics/1");
      expect(prompt).toContain("epic_get");
      expect(prompt).toContain('detail: "full"');
      // ⚠️ The load-bearing one, kept from the dialog era. `useAgentPrompt`
      // takes seven named fields rather than the epic resource precisely so
      // nothing can ride along into a clipboard.
      expect(prompt).not.toContain("sg_");
    });

    /**
     * The project's TITLE reaches `project_name`, not its slug.
     * `resolveProjectId` matches titles lowercased and never slugs, so a
     * project whose two differ is where the old prompt silently stopped
     * resolving.
     */
    it("names the project by its title, not by its slug", async () => {
      const written = stubClipboard();
      await mount(undefined, undefined, {
        ...projectFixture(),
        title: "Kanban v2",
        slug: "kanban-v2",
      });

      const items = await openAgentPrompts(
        await openRowMenu("#E1 - Planned epic"),
      );
      fireEvent.click(
        items.find((item) => item.textContent?.includes("Review"))!,
      );

      await waitFor(() => expect(written).toHaveLength(1));
      expect(written[0]).toContain('project_name "Kanban v2"');
      expect(written[0]).not.toContain('project_name "kanban-v2"');
    });

    /**
     * ⚠️ `projectFixture()` turns every declared option ON, so every case
     * above gets `agentPrompts` for free and this is the only one that has
     * to say anything. It is also the one that matters in production on the
     * day this ships: the option is off by default and nobody has turned it
     * on yet.
     */
    it("offers nothing when the project has agent prompts off", async () => {
      await mount(
        undefined,
        undefined,
        projectFixture({ options: { work: { agentPrompts: false } } }),
      );

      const items = (await openRowMenu("#E1 - Planned epic")).map(
        (item) => item.textContent,
      );
      expect(items.join(" ")).not.toContain("Agent Prompts");
      expect(items.join(" ")).not.toContain("Review");
      // Mark as ready is untouched: it is the epic's own lifecycle move and
      // has nothing to do with this option.
      expect(items.join(" ")).toContain("Mark as ready");
    });
  });
  /**
   * Setting the release from the row menu (#Q2098). The list SHOWED which
   * release an epic ships in and could not change it, so a correction was a
   * page load and a trip back for one field.
   *
   * The rules under test are `EpicReleaseControl`'s, which is the point: the
   * menu reads them from `releaseRowMenu` rather than restating them, and a
   * second copy is how the two surfaces end up disagreeing about what may
   * be picked.
   */
  describe("the release submenu", () => {
    const aRelease = (id: number, tag: string, released?: string) => ({
      id,
      projectId: 1,
      number: id,
      tag,
      title: tag,
      description: "",
      releasedAt: released,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
    });

    const RELEASES = [
      aRelease(7, "0.28.0", "2026-09-03T00:00:00.000Z"),
      aRelease(8, "0.29.0"),
      aRelease(9, "0.30.0"),
    ];

    const openRowMenu = async (name: string) => {
      const row = screen.getByRole("link", { name }).closest("tr");
      expect(row).not.toBeNull();
      fireEvent.click(
        within(row!).getByRole("button", { name: "Open row actions" }),
      );
      return await waitFor(() => {
        const found = document.querySelectorAll('[role="menuitem"]');
        if (found.length === 0) throw new Error("not open yet");
        return [...found];
      });
    };

    /**
     * ⚠️ The children are `menuitemcheckbox`, not `menuitem`: they declare
     * `checked`, which is what marks the row's current release. A query by
     * `menuitem` finds the group's own trigger and nothing inside it.
     */
    const openReleases = async (items: Element[]) => {
      const trigger = items.find((item) =>
        item.textContent?.includes("Set Release"),
      );
      if (!trigger) return [];
      fireEvent.click(trigger);
      return await waitFor(() => {
        const found = [
          ...document.querySelectorAll('[role="menuitemcheckbox"]'),
        ];
        if (found.length === 0) throw new Error("submenu not open yet");
        return found;
      });
    };

    it("offers the open releases and No release, never a published one", async () => {
      await mount(RELEASES, [epicOf(1, "Planned epic", "planned")]);

      const entries = await openReleases(
        await openRowMenu("#E1 - Planned epic"),
      );
      const labels = entries.map((entry) => entry.textContent ?? "");
      expect(labels.join(" ")).toContain("0.29.0");
      expect(labels.join(" ")).toContain("0.30.0");
      expect(labels.join(" ")).toContain("No release");
      // 0.28.0 is published, and this epic is not in it. Attaching would be
      // refused server-side, so it is never offered.
      expect(labels.join(" ")).not.toContain("0.28.0");
    });

    it("marks the release the epic is already in", async () => {
      await mount(RELEASES, [epicOf(1, "Planned epic", "planned", 9)]);

      const entries = await openReleases(
        await openRowMenu("#E1 - Planned epic"),
      );
      const checked = entries.filter(
        (entry) => entry.getAttribute("aria-checked") === "true",
      );
      expect(checked).toHaveLength(1);
      expect(checked[0]?.textContent).toContain("0.30.0");
    });

    it("marks No release when the epic is in none", async () => {
      await mount(RELEASES, [epicOf(1, "Planned epic", "planned")]);

      const entries = await openReleases(
        await openRowMenu("#E1 - Planned epic"),
      );
      const checked = entries.filter(
        (entry) => entry.getAttribute("aria-checked") === "true",
      );
      expect(checked).toHaveLength(1);
      expect(checked[0]?.textContent).toContain("No release");
    });

    /**
     * The epic's own published release stays in the list so the menu can say
     * what it is, and every entry is disabled so it cannot be changed - the
     * same pair the control expresses as "keep it in `options`, disable the
     * trigger". Dropping it instead would read as though the attachment had
     * been lost.
     */
    it("shows a published attachment and refuses to move it", async () => {
      await mount(RELEASES, [epicOf(1, "Planned epic", "planned", 7)]);

      const entries = await openReleases(
        await openRowMenu("#E1 - Planned epic"),
      );
      const labels = entries.map((entry) => entry.textContent ?? "");
      expect(labels.join(" ")).toContain("0.28.0");
      expect(
        entries.find((entry) => entry.getAttribute("aria-checked") === "true")
          ?.textContent,
      ).toContain("0.28.0");
      for (const entry of entries) {
        expect(entry.getAttribute("data-disabled")).not.toBeNull();
      }
    });

    /**
     * An empty group renders nothing and does not create the three-dots
     * trigger by itself, so a project with no open release needs no case of
     * its own. Read as intended rather than as a missing feature: there is
     * nothing to pick, and an entry that could only say "No release" to an
     * epic that already has none is noise.
     */
    it("offers no submenu while the project has no open release", async () => {
      await mount(
        [aRelease(7, "0.28.0", "2026-09-03T00:00:00.000Z")],
        [epicOf(1, "Planned epic", "planned")],
      );

      const items = (await openRowMenu("#E1 - Planned epic")).map(
        (item) => item.textContent,
      );
      expect(items.join(" ")).not.toContain("Set Release");
      // The rest of the menu is untouched.
      expect(items.join(" ")).toContain("Mark as ready");
    });
  });
});
