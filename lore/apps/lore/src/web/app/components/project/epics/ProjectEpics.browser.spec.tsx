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
    epicOf(2, "Active epic", "active"),
    epicOf(3, "Done epic", "done"),
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
 * The status filter takes several statuses (feedback #2069): Planned plus
 * Active, the everyday view, used to be impossible with one value at a
 * time. An empty selection still means every status.
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
    expect(row("#E2 - Active epic")).not.toBeNull();
    expect(row("#E3 - Done epic")).not.toBeNull();
  });

  it("keeps Planned and Active when both are selected, and hides Done", async () => {
    await mount();

    const status = screen.getByRole("combobox", { name: "Status" });
    fireEvent.keyDown(status, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /Planned/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Active/ }));

    await waitFor(() => expect(row("#E3 - Done epic")).toBeNull());
    expect(row("#E1 - Planned epic")).not.toBeNull();
    expect(row("#E2 - Active epic")).not.toBeNull();
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
      epicOf(1, "Shipped epic", "done", 7),
      epicOf(2, "Next epic", "active", 8),
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

    it("is offered on a planned epic, beside Begin", async () => {
      await mount();

      // The top level carries the group and Begin. Review is one level in,
      // which is what the submenu changed.
      //
      // ⚠️ The row menu is opened ONCE and the list reused: the three-dots
      // trigger toggles, so opening it again to read the submenu closes it.
      const opened = await openRowMenu("#E1 - Planned epic");
      const top = opened.map((item) => item.textContent);
      expect(top.join(" ")).toContain("Agent Prompts");
      expect(top.join(" ")).toContain("Begin");
      expect(top.join(" ")).not.toContain("Review");

      const inside = (await openAgentPrompts(opened)).map(
        (item) => item.textContent,
      );
      expect(inside.join(" ")).toContain("Review");
      expect(inside.join(" ")).toContain("Activate");
    });

    it("drops Review once the epic has begun but keeps Activate", async () => {
      await mount();

      // Reviewing a plan is a thing you do while the plan is still open;
      // after Begin the quest set is what is being worked. Activate stays,
      // because a half-worked epic can still be handed over, and Begin is
      // gone because it has already happened.
      const opened = await openRowMenu("#E2 - Active epic");
      const top = opened.map((item) => item.textContent);
      expect(top.join(" ")).toContain("Agent Prompts");
      expect(top.join(" ")).not.toContain("Begin");

      const inside = (await openAgentPrompts(opened)).map(
        (item) => item.textContent,
      );
      expect(inside.join(" ")).toContain("Activate");
      expect(inside.join(" ")).not.toContain("Review");
    });

    /**
     * ⚠️ The empty-group case. A `done` epic passes neither gate, so the
     * group has no children, and #Q1959's effective-entry count is what
     * keeps it from rendering a trigger over an empty menu.
     */
    it("offers no group at all on a concluded epic", async () => {
      await mount();

      const top = (await openRowMenu("#E3 - Done epic")).map(
        (item) => item.textContent,
      );
      expect(top.join(" ")).not.toContain("Agent Prompts");
      expect(top.join(" ")).not.toContain("Review");
      expect(top.join(" ")).not.toContain("Activate");
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
      // Begin is untouched: it is the epic's own lifecycle action and has
      // nothing to do with this option.
      expect(items.join(" ")).toContain("Begin");
    });
  });
});
