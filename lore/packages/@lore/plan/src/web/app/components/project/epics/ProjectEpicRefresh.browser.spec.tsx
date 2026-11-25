import { DialogProvider } from "@alepha/ui";
import { projectFixture, virtualClientFake } from "@lore/core/testing";
import {
  currentProjectAtom,
  I18n,
  ResourceTabRegistry,
  PinnedPromptsSlot,
} from "@lore/core/web";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact, QueryCache } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { EpicResource } from "../../../../../api/schemas/epicResourceSchema.ts";
import { WorkShell } from "../../../shell/WorkShell.ts";
import ProjectEpic from "./ProjectEpic.tsx";

let hidden = false;
Object.defineProperty(document, "hidden", {
  configurable: true,
  get: () => hidden,
});
const setHidden = (value: boolean) => {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
};

const epicOf = (
  status: EpicResource["status"],
  over: Partial<EpicResource> = {},
): EpicResource =>
  ({
    id: 5,
    number: 5,
    projectId: 1,
    title: "Epic 5",
    description: "",
    status,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    progress: { completed: 0, inProgress: 1, shelved: 0, total: 2 },
    ...over,
  }) as unknown as EpicResource;

/**
 * The server: the epic it answers, which a spec moves, and the reads made.
 */
class FakeLinkProvider extends LinkProvider {
  public epicReads = 0;
  public questReads = 0;
  public served?: EpicResource;

  override client(): any {
    return virtualClientFake({
      getEpicByNumber: async () => {
        this.epicReads++;
        return this.served;
      },
      getQuests: async () => {
        this.questReads++;
        return { content: [] };
      },
      getEpicReviews: async () => ({ items: [], open: 0 }),
      getProjectUsers: async () => [],
    });
  }
}

/**
 * The epic page keeps itself current (#Q3860), as the quest page does: the
 * epic and its quests on a tab return, and every 15 s only while the epic is
 * in progress and the page visible, never while the edit sheet is open.
 */
describe("ProjectEpic refresh", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    cleanup();
    hidden = false;
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (status: EpicResource["status"]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    alepha.inject(ResourceTabRegistry);
    alepha.inject(WorkShell);
    // Core's pins slot (#E175), read by the page's robot button.
    alepha.inject(PinnedPromptsSlot);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, projectFixture());
    const dateTime = alepha.inject(DateTimeProvider);
    dateTime.pause();
    const server = alepha.inject(FakeLinkProvider);
    const epic = epicOf(status);
    server.served = epic;
    // What the route loader does.
    alepha.inject(QueryCache).set(["epic", 1, 5], epic);

    const app = alepha;
    render(
      <AlephaContext.Provider value={app}>
        <DialogProvider>
          <ProjectEpic epic={epic} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
    await screen.findByRole("radio", { name: /Quests/ });
    // The quests' first read, on mount.
    await waitFor(() => expect(server.questReads).toBe(2));
    const travel = (seconds: number) =>
      act(() => dateTime.travel([seconds, "seconds"]));
    return { server, travel };
  };

  it("polls the epic and its quests every 15 s while in progress, and stops once it is not", async () => {
    const { server, travel } = await mount("in_progress");
    expect(server.epicReads).toBe(0);

    await travel(15);
    await waitFor(() => expect(server.epicReads).toBe(1));
    // `getQuests` twice per read: the open quests, then the shelved ones.
    await waitFor(() => expect(server.questReads).toBe(4));

    server.served = epicOf("completed", {
      title: "Epic 5, done",
      updatedAt: "2026-09-01T11:00:00.000Z",
    });
    await travel(15);
    await waitFor(() => expect(server.epicReads).toBe(2));
    // The epic's tick lands first (`travel()` runs the timers in order), and
    // the page, now on a completed epic, stops the quests' timer before it
    // fires.
    expect(server.questReads).toBe(4);
    // The page follows it.
    await waitFor(() =>
      expect(screen.getAllByText("Epic 5, done").length).toBeGreaterThan(0),
    );

    await travel(60);
    expect(server.epicReads).toBe(2);
    expect(server.questReads).toBe(4);
  });

  it("sends no request while the document is hidden", async () => {
    const { server, travel } = await mount("in_progress");

    setHidden(true);
    await travel(45);
    expect(server.epicReads).toBe(0);
    expect(server.questReads).toBe(2);
  });

  it("has no timer on a ready epic, only the tab return", async () => {
    const { server, travel } = await mount("ready");

    await travel(60);
    expect(server.epicReads).toBe(0);

    setHidden(true);
    setHidden(false);
    await waitFor(() => expect(server.epicReads).toBe(1));
  });

  it("does not read on a tab return while the edit sheet is open", async () => {
    const { server, travel } = await mount("ready");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("dialog");

    await travel(60);
    setHidden(true);
    setHidden(false);
    await travel(1);
    // The page's own reads only: the sheet's quest picker reads once.
    expect(server.epicReads).toBe(0);
  });
});
