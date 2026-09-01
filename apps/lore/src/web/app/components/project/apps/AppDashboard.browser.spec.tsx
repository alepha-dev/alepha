import { cleanup, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime, DateTimeProvider } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { SigilResource } from "@/api/schemas/sigilResourceSchema.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import AppDashboard from "./AppDashboard.tsx";

/**
 * Records every action the page reaches for.
 *
 * The point of the whole rebuild is that this page costs nothing to open, and
 * "costs nothing" is only checkable by watching what it asks for. Same
 * substitution seam as `QuestDependencyPicker.browser.spec.tsx` (`CLAUDE.md`:
 * never `vi.mock` / `vi.spyOn`).
 */
class RecordingLinkProvider extends LinkProvider {
  public calls: string[] = [];

  /**
   * What a named action answers, when a case cares. Everything else answers
   * `{}`, which is what most of them want.
   */
  public responses: Record<string, unknown> = {};

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => async () => {
          this.calls.push(prop);
          return this.responses[prop] ?? {};
        },
      },
    );
  }
}

const sigilOf = (over: Partial<SigilResource> = {}): SigilResource => ({
  id: "00000000-0000-4000-8000-000000000001",
  projectId: 1,
  name: "docs-production",
  tokenPrefix: "sg_lore_ab",
  kinds: ["beacon", "vitals", "blights", "feedback"],
  createdAt: "2026-08-01T10:00:00.000Z",
  ...over,
});

describe("AppDashboard", () => {
  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before anything that instantiates it: a substitution after that is
      // too late.
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n);
    // The dictionaries are lazy chunks on a service, so nothing loads them
    // until something injects it.
    alepha.inject(I18n);
    await alepha.start();
    return alepha;
  };

  const show = async (
    sigil: SigilResource,
    responses: Record<string, unknown> = {},
  ) => {
    // Testing Library binds its queries to `document.body`, so a second render
    // in one test would search the first one's DOM as well. Several cases here
    // deliberately render twice to compare two states.
    cleanup();
    const alepha = await mount();
    alepha.store.set(currentSigilAtom, sigil as never);
    // The Artifacts card reads the project for its id and its slug, so without
    // this it would stay disabled and every case below would pass by not
    // running the code they are about.
    alepha.store.set(currentProjectAtom, {
      id: 1,
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
      title: "Alepha",
      slug: "alepha",
      createdBy: "00000000-0000-4000-8000-000000000001",
      areas: [],
      features: defaultProjectFeatures,
      kanbanColumns: ["In Progress"],
      unlockedFeatures: [],
      unlockHistory: [],
    } as never);
    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = responses;
    return {
      links,
      dateTime: alepha.inject(DateTimeProvider),
      ...render(
        <AlephaContext.Provider value={alepha}>
          <AppDashboard />
        </AlephaContext.Provider>,
      ),
    };
  };

  /**
   * The property the rebuild exists for. This page used to render three
   * counters out of an insights payload, so opening the front page of an app
   * cost ten aggregate queries against Analytics Engine.
   *
   * ⚠️ This used to read "asks the server for nothing at all", and epic #18
   * made that literally false: the Artifacts card issues one listing. The
   * invariant was never "no request" though - it was **no analytics**. One
   * indexed read of a small table is a different cost class from ten aggregate
   * queries, and the assertion is written as a whitelist so a future insights
   * call cannot creep back in unnoticed.
   */
  it("issues one artifact listing and no analytics query", async ({
    expect,
  }) => {
    const { links, getByTestId } = await show(sigilOf());

    expect(getByTestId("app-identity")).toBeTruthy();
    // Awaited: the listing is an effect, so asserting synchronously would
    // read an empty array and pass for the wrong reason.
    await waitFor(() => expect(links.calls).toEqual(["listArtifacts"]));
  });

  describe("the artifacts card", () => {
    const listing = (groups: unknown[]) => ({
      listArtifacts: { groups, truncated: false },
    });

    /**
     * ⚠️ Empty is a normal, and often permanent, state here. Everything else
     * on this page is derived from telemetry the app itself pushes; artifacts
     * come from CI, a second foreign system that can be absent entirely. An
     * error or an ominous blank would report a fault where there is none.
     */
    it("tells a project with no pipeline how to start", async ({ expect }) => {
      const { findByText, getByTestId } = await show(sigilOf(), listing([]));

      expect(await findByText(/No artifacts pushed yet/)).toBeTruthy();
      expect(getByTestId("app-artifacts").textContent).toContain(
        "alepha lore artifacts push --project alepha --app docs-production",
      );
    });

    /**
     * The property the whole `(app, tag, runtime)` key exists for: `1.2.3` is
     * ONE release with two builds, and a flat list would render it as two.
     */
    it("draws one row per tag, with its runtimes beside it", async ({
      expect,
    }) => {
      const { findByText, getByTestId } = await show(
        sigilOf(),
        listing([
          {
            app: "docs-production",
            tag: "1.2.3",
            pushedAt: "2026-08-30T10:00:00.000Z",
            commitSha: "0b35cb375ff",
            variants: [
              {
                id: "00000000-0000-4000-8000-000000000010",
                projectId: 1,
                app: "docs-production",
                tag: "1.2.3",
                runtime: "node",
                sha256: "a".repeat(64),
                size: 4_400_000,
                createdAt: "2026-08-30T10:00:00.000Z",
                updatedAt: "2026-08-30T10:00:00.000Z",
              },
              {
                id: "00000000-0000-4000-8000-000000000011",
                projectId: 1,
                app: "docs-production",
                tag: "1.2.3",
                runtime: "workerd",
                sha256: "b".repeat(64),
                size: 8_800_000,
                createdAt: "2026-08-30T10:00:00.000Z",
                updatedAt: "2026-08-30T10:00:00.000Z",
              },
            ],
          },
        ]),
      );

      expect(await findByText("1.2.3")).toBeTruthy();
      const card = getByTestId("app-artifacts").textContent ?? "";
      expect(card).toContain("node");
      expect(card).toContain("workerd");
      // The digest is short on the row; the whole value lives on the title.
      expect(card).toContain("a".repeat(12));
      expect(card).not.toContain("a".repeat(64));
      // The heaviest variant, since only one of the two is ever deployed.
      expect(card).toContain("8.8 MB");
      // Short, and only because CI sent one.
      expect(card).toContain("0b35cb3");
    });

    it("shows no commit when the push named none", async ({ expect }) => {
      const { findByText, getByTestId } = await show(
        sigilOf(),
        listing([
          {
            app: "docs-production",
            tag: "latest",
            pushedAt: "2026-08-30T10:00:00.000Z",
            variants: [
              {
                id: "00000000-0000-4000-8000-000000000012",
                projectId: 1,
                app: "docs-production",
                tag: "latest",
                runtime: "workerd",
                sha256: "c".repeat(64),
                size: 1_000_000,
                createdAt: "2026-08-30T10:00:00.000Z",
                updatedAt: "2026-08-30T10:00:00.000Z",
              },
            ],
          },
        ]),
      );

      expect(await findByText("latest")).toBeTruthy();
      expect(
        getByTestId("app-artifacts").querySelector(
          "svg.lucide-git-commit-horizontal",
        ),
      ).toBeNull();
    });
  });

  /**
   * Absent is not off. An older client reports no config, and an app that has
   * never reported has told us nothing either, and rendering both as "off" would
   * accuse an app of collecting nothing on no evidence.
   */
  it("reads an unreported config as unknown, never as off", async ({
    expect,
  }) => {
    const { getAllByText, getByTestId } = await show(sigilOf());

    const capabilities = getByTestId("app-capabilities");
    // One per capability row, on the "app sends" side only.
    expect(getAllByText("Unknown")).toHaveLength(4);
    expect(capabilities.textContent).toContain(
      "This app has not reported its configuration",
    );
  });

  /**
   * The comparison this card exists to make. It was invisible in both
   * directions: the app's own switches lived in its deploy and Lore's lived on
   * a settings page, and nothing ever put them on one screen.
   */
  it("marks a capability the app sends and Lore refuses", async ({
    expect,
  }) => {
    const { getByTestId, getAllByLabelText } = await show(
      sigilOf({
        // Lore accepts views only.
        kinds: ["beacon"],
        // The app says it sends everything.
        reportedConfig: {
          trackers: { views: true, errors: true, vitals: true },
          feedback: true,
          feedbackButton: "bottom-right",
          feedbackButtonExcludedPaths: [],
          reportOutsideProduction: false,
        },
        reportedConfigAt: "2026-08-28T09:00:00.000Z",
      }),
    );

    expect(getByTestId("app-capabilities").textContent).toContain(
      "Reported by the app on",
    );
    // Three rows disagree: errors, vitals and feedback are all sent and all
    // refused. Views is the one that agrees, and carries no marker.
    expect(
      getAllByLabelText("The app and Lore disagree about this one"),
    ).toHaveLength(3);
  });

  it("agrees quietly when both sides say the same thing", async ({
    expect,
  }) => {
    const { queryByLabelText } = await show(
      sigilOf({
        kinds: ["beacon"],
        reportedConfig: {
          trackers: { views: true, errors: false, vitals: false },
          feedback: false,
          feedbackButton: "hidden",
          feedbackButtonExcludedPaths: [],
          reportOutsideProduction: false,
        },
        reportedConfigAt: "2026-08-28T09:00:00.000Z",
      }),
    );

    expect(
      queryByLabelText("The app and Lore disagree about this one"),
    ).toBeNull();
  });

  it("badges an app that has said nothing for a day", async ({ expect }) => {
    const stale = await show(
      sigilOf({ lastSeenAt: "2020-01-01T00:00:00.000Z" }),
    );
    expect(stale.getByText("Silent")).toBeTruthy();

    // From the container's own clock rather than the wall clock, so the
    // assertion cannot drift under `travel()` or a pinned test time.
    const recent = await show(
      sigilOf({
        lastSeenAt: new Date(stale.dateTime.nowMillis() - 60_000).toISOString(),
      }),
    );
    expect(recent.queryByText("Silent")).toBeNull();
  });

  it("says the address is not known rather than inventing one", async ({
    expect,
  }) => {
    const unknown = await show(sigilOf());
    expect(unknown.getByText("Not known yet")).toBeTruthy();

    const detected = await show(sigilOf({ lastSeenHost: "docs.alepha.dev" }));
    expect(detected.getByText("docs.alepha.dev")).toBeTruthy();

    // The operator's pin wins over the detected host, silently.
    const pinned = await show(
      sigilOf({
        lastSeenHost: "docs.alepha.dev",
        url: "https://alepha.dev/docs",
      }),
    );
    expect(pinned.getByText("alepha.dev/docs")).toBeTruthy();
  });
});
