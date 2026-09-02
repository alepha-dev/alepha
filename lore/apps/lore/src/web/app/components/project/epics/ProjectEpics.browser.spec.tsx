import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  const mount = async () => {
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
    alepha.store.set(currentReleasesAtom, [] as never);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectEpics />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await view.findByRole("link", { name: "#1 - Planned epic" });
    return view;
  };

  const row = (name: string) => screen.queryByRole("link", { name });

  it("shows every status while nothing is selected", async () => {
    await mount();

    expect(row("#1 - Planned epic")).not.toBeNull();
    expect(row("#2 - Active epic")).not.toBeNull();
    expect(row("#3 - Done epic")).not.toBeNull();
  });

  it("keeps Planned and Active when both are selected, and hides Done", async () => {
    await mount();

    const status = screen.getByRole("combobox", { name: "Status" });
    fireEvent.keyDown(status, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /Planned/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Active/ }));

    await waitFor(() => expect(row("#3 - Done epic")).toBeNull());
    expect(row("#1 - Planned epic")).not.toBeNull();
    expect(row("#2 - Active epic")).not.toBeNull();
    // The trigger says how many, the way the Quests list's does.
    expect(status.textContent).toContain("2 status");
  });
});
