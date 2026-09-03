import { cleanup, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { ProjectActivityEvent } from "@/api/schemas/projectActivitySchema.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectActivityPage from "./ProjectActivityPage.tsx";

/**
 * Answers `getProjectActivity` and records the query it was asked with, so a
 * case can assert both what rendered and what was requested. Substitution
 * rather than `vi.mock`, per CLAUDE.md.
 */
class FakeLinkProvider extends LinkProvider {
  public events: ProjectActivityEvent[] = [];
  public lastQuery: Record<string, unknown> | undefined;

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => async (input: any) => {
          if (prop === "getProjectActivity") {
            this.lastQuery = input?.query;
            return {
              events: this.events,
              truncated: false,
              since: "2026-09-01T00:00:00.000Z",
              sinceClamped: false,
              until: "2026-09-03T00:00:00.000Z",
            };
          }
          return {};
        },
      },
    );
  }
}

/**
 * Only the routes the rows link to. The real `AppRouter` is not mounted:
 * these cases are about the feed, not about the route table.
 */
class Routes {
  quest = $page({
    name: "projectQuest",
    path: "/quests/:shortId",
    component: () => null,
  });
  epic = $page({
    name: "projectEpic",
    path: "/epics/:epicNumber",
    component: () => null,
  });
  folio = $page({
    name: "projectFoliosFolio",
    path: "/folios/:shortId",
    component: () => null,
  });
  release = $page({
    name: "projectRelease",
    path: "/releases/:releaseTag",
    component: () => null,
  });
}

const event = (over: Partial<ProjectActivityEvent>): ProjectActivityEvent => ({
  at: "2026-09-02T10:00:00.000Z",
  kind: "quest.created",
  actor: "feunard",
  summary: "filed quest #1",
  ...over,
});

describe("ProjectActivityPage", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    cleanup();
    await alepha?.stop();
    alepha = undefined;
  });

  const show = async (events: ProjectActivityEvent[]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before the modules that reach for it: `AlephaReactRouter`
      // instantiates `LinkProvider`, and a substitution after that is too
      // late.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    alepha.inject(FakeLinkProvider).events = events;
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(currentProjectAtom, {
      id: 1,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
      title: "Alepha",
      slug: "alepha",
      createdBy: "00000000-0000-4000-8000-000000000001",
      areas: [],
      features: defaultProjectFeatures,
      kanbanColumns: ["In Progress"],
      unlockedFeatures: [],
      unlockHistory: [],
    } as never);

    return render(
      <AlephaContext.Provider value={alepha}>
        <ProjectActivityPage />
      </AlephaContext.Provider>,
    );
  };

  it("asks for the caller's own events, unlike the MCP default", async ({
    expect,
  }) => {
    await show([event({ quest: { shortId: 1, title: "Wire it" } })]);

    await waitFor(() => {
      expect(alepha!.inject(FakeLinkProvider).lastQuery).toBeDefined();
    });
    // The endpoint defaults this off because an agent is asking what OTHERS
    // did. A person opening their own project is asking the opposite, and on
    // a solo project the feed is empty without it.
    expect(alepha!.inject(FakeLinkProvider).lastQuery?.includeOwn).toBe(true);
  });

  it("badges a machine-written comment and leaves a human one plain", async ({
    expect,
  }) => {
    const screen = await show([
      event({
        kind: "quest.commented",
        actorKind: "agent",
        summary: "commented on quest #1",
        quest: { shortId: 1, title: "Machine wrote here" },
      }),
      event({
        kind: "quest.commented",
        summary: "commented on quest #2",
        quest: { shortId: 2, title: "Person wrote here" },
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("Machine wrote here")).toBeTruthy();
    });
    // One badge, not two: `quest_comments.source` is the only place
    // provenance is recorded, so an unmarked row means "unknown", never
    // "human", and must not be labelled either way.
    expect(screen.queryAllByText("Agent")).toHaveLength(1);
  });

  it("links a release that has a tag and does not link one that has none", async ({
    expect,
  }) => {
    const screen = await show([
      event({
        kind: "release.published",
        summary: "published release 0.1.0",
        release: { tag: "0.1.0", title: "Tagged release" },
      }),
      event({
        kind: "release.created",
        summary: "opened release",
        release: { title: "Untagged release" },
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("Tagged release")).toBeTruthy();
    });
    // `releases.tag` is nullable at the column even though the create schema
    // requires it. Without the guard the second row renders an anchor to
    // `/alepha/releases/undefined`, which resolves to nothing.
    expect(screen.getByText("Tagged release").closest("a")).toBeTruthy();
    expect(screen.getByText("Untagged release").closest("a")).toBeNull();
  });

  it("filters client-side without re-querying", async ({ expect }) => {
    const screen = await show([
      event({ quest: { shortId: 1, title: "A quest happened" } }),
      event({
        kind: "folio.updated",
        summary: "wrote folio #3",
        folio: { shortId: 3, title: "A folio happened" },
      }),
    ]);

    await waitFor(() => {
      expect(screen.getByText("A folio happened")).toBeTruthy();
    });

    const before = alepha!.inject(FakeLinkProvider).lastQuery;
    screen.getByRole("button", { name: "Folios" }).click();

    await waitFor(() => {
      expect(screen.queryByText("A quest happened")).toBeNull();
    });
    expect(screen.getByText("A folio happened")).toBeTruthy();
    // The window control is the only thing that may re-query; the chips
    // narrow rows already on the page.
    expect(alepha!.inject(FakeLinkProvider).lastQuery).toBe(before);
  });
});
