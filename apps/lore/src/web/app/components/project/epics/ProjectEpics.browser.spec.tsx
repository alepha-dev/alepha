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

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import EpicReviewPromptDialog from "./EpicReviewPromptDialog.tsx";
import ProjectEpics from "./ProjectEpics.tsx";

const epicOf = (
  number: number,
  title: string,
  status: EpicResource["status"],
): EpicResource =>
  ({
    id: number,
    number,
    projectId: 1,
    title,
    description: "",
    status,
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

  const mount = async (releases: unknown[] = []) => {
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
    alepha.store.set(currentProjectAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      title: "Lore",
      slug: "lore",
      createdBy: "00000000-0000-4000-8000-000000000001",
      areas: [],
      features: defaultProjectFeatures,
      kanbanColumns: ["In Progress"],
      unlockedFeatures: [],
      unlockHistory: [],
    } as never);
    alepha.store.set(currentReleasesAtom, releases as never);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectEpics />
          {/* Mounted in `Layout` in the app, so this spec supplies its own.
              Review writes an atom rather than the clipboard now, and the
              dialog is what reads it. */}
          <EpicReviewPromptDialog />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await view.findByRole("link", { name: "#E1 - Planned epic" });
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

    it("is offered on a planned epic, beside Begin", async () => {
      await mount();

      const items = (await openRowMenu("#E1 - Planned epic")).map(
        (item) => item.textContent,
      );

      expect(items.join(" ")).toContain("Review");
      expect(items.join(" ")).toContain("Begin");
    });

    it("is not offered once the epic has begun", async () => {
      await mount();

      // Reviewing a plan is a thing you do while the plan is still open;
      // after Begin the quest set is what is being worked.
      const items = (await openRowMenu("#E2 - Active epic")).map(
        (item) => item.textContent,
      );

      expect(items.join(" ")).not.toContain("Review");
      expect(items.join(" ")).not.toContain("Begin");
    });

    /**
     * ⚠️ Review no longer copies on click (feedback #2097). It opens the
     * prompt for editing first, so this asserts the DIALOG'S initial value -
     * the same guarantee, moved to where the text now appears.
     */
    it("opens the prompt, prefilled with the epic, the URL and the calls that read it", async () => {
      await mount();

      const items = await openRowMenu("#E1 - Planned epic");
      const review = items.find((item) => item.textContent?.includes("Review"));
      expect(review).toBeTruthy();
      fireEvent.click(review!);

      const editor = (await screen.findByTestId(
        "epic-review-prompt-text",
      )) as HTMLTextAreaElement;
      const prompt = editor.value;
      expect(prompt).toContain("#E1");
      expect(prompt).toContain("Planned epic");
      expect(prompt).toContain("/epics/1");
      expect(prompt).toContain("epic_get");
      expect(prompt).toContain('detail: "full"');
      // Nothing that is not the four fields the builder takes. Letting a
      // human edit the text before copying does not weaken this: the
      // guarantee is about what Lore ADDS, and what Lore added is this value.
      expect(prompt).not.toContain("sg_");
    });

    it("copies what the reader edited, not what was built", async () => {
      const written = stubClipboard();
      await mount();

      const items = await openRowMenu("#E1 - Planned epic");
      fireEvent.click(
        items.find((item) => item.textContent?.includes("Review"))!,
      );

      const editor = (await screen.findByTestId(
        "epic-review-prompt-text",
      )) as HTMLTextAreaElement;
      // The one sentence of context that was the whole point of the report.
      fireEvent.change(editor, {
        target: { value: `${editor.value}\n\nFocus on the migration.` },
      });

      fireEvent.click(screen.getByRole("button", { name: "Copy and close" }));

      await waitFor(() => expect(written).toHaveLength(1));
      expect(written[0]).toContain("Focus on the migration.");
      // Still the built prompt underneath, not a replacement.
      expect(written[0]).toContain("epic_get");
    });

    it("copies nothing when the reader cancels", async () => {
      const written = stubClipboard();
      await mount();

      const items = await openRowMenu("#E1 - Planned epic");
      fireEvent.click(
        items.find((item) => item.textContent?.includes("Review"))!,
      );
      await screen.findByTestId("epic-review-prompt-text");

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() =>
        expect(screen.queryByTestId("epic-review-prompt-text")).toBeNull(),
      );
      expect(written).toHaveLength(0);
    });
  });
});
