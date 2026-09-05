import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectArtifacts from "./ProjectArtifacts.tsx";

/**
 * Records every action the page reaches for and answers what a case set.
 * Same substitution seam as `AppArtifacts.browser.spec.tsx` (`CLAUDE.md`:
 * never `vi.mock` / `vi.spyOn`).
 */
class RecordingLinkProvider extends LinkProvider {
  public calls: string[] = [];
  public responses: Record<string, unknown> = {};

  override client(): any {
    return new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          const call = async () => {
            this.calls.push(prop);
            return this.responses[prop] ?? {};
          };
          return Object.assign(call, { can: () => true });
        },
      },
    );
  }
}

/**
 * The routes the page links into. `projectRelease` is the one that matters:
 * the tag column links there only when a release with that tag exists.
 */
class Routes {
  app = $page({
    name: "app",
    path: "/:projectSlug/apps/:appName",
    component: () => null,
  });
  projectRelease = $page({
    name: "projectRelease",
    path: "/:projectSlug/releases/:releaseTag",
    component: () => null,
  });
}

const group = (over: Record<string, unknown> = {}) => ({
  app: "docs",
  tag: "1.0.0",
  pushedAt: "2026-09-01T10:00:00.000Z",
  commitSha: "abcdef1234567890",
  variants: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      projectId: 1,
      app: "docs",
      tag: "1.0.0",
      runtime: "workerd",
      sha256: "a".repeat(64),
      size: 2_000_000,
      commitSha: "abcdef1234567890",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
  ],
  ...over,
});

/**
 * The project Artifacts page (feedback #2111).
 *
 * Two things are worth a spec here and neither is the table itself, which is
 * `AlephaTable`'s own: what a project with NO artifacts is told, and that
 * `truncated` reaches the reader. The second is the one that would fail
 * silently - a client-side pager cannot narrow a read it has already made, so
 * a swallowed `truncated` shows a subset under a footer stating a total.
 */
describe("ProjectArtifacts", () => {
  const show = async (
    responses: Record<string, unknown> = {},
    releases: unknown[] = [],
  ) => {
    cleanup();
    // ⚠️ `persistenceKey` puts the filter values in localStorage, and the
    // store outlives a `cleanup()`. Without this the search set by one case
    // narrows the table of the next one, which is an order-dependent suite
    // that passes alone and fails in a file.
    window.localStorage.clear();
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before anything that instantiates it: a substitution after that is
      // too late.
      .with({ provide: LinkProvider, use: RecordingLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();

    // Without the project the query stays disabled and every case below
    // would pass by not running the code it is about.
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
    alepha.store.set(currentReleasesAtom, releases as never);

    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = responses;
    return {
      links,
      ...render(
        <AlephaContext.Provider value={alepha}>
          <ProjectArtifacts />
        </AlephaContext.Provider>,
      ),
    };
  };

  const listing = (groups: unknown[], truncated = false) => ({
    listArtifacts: { groups, truncated },
  });

  /**
   * The whole reason this page exists: one project-scoped read with no `app`
   * narrowing. Asserted as an exact list so a per-app fan-out cannot creep
   * in.
   */
  it("issues one project-wide artifact listing", async ({ expect }) => {
    const { links } = await show(listing([group()]));

    await waitFor(() => expect(links.calls).toEqual(["listArtifacts"]));
  });

  /**
   * ⚠️ Empty is normal AND permanent for a project with no CI, and this page
   * is always in the sidebar - unlike the app tab, which is only reached once
   * an app exists. So the empty state has to be the place the capability is
   * learned, which is why the entry is not hidden behind a count.
   */
  it("tells a project with no artifacts how to push one", async ({
    expect,
  }) => {
    const { findByText, getByTestId } = await show(listing([]));

    expect(await findByText(/Nothing has been pushed yet/)).toBeTruthy();
    expect(getByTestId("artifacts-table").textContent).toContain(
      "lore artifacts push --project alepha --app <app>",
    );
  });

  /**
   * The one that fails silently if forgotten. `limit` caps the rows read
   * BEFORE grouping and the endpoint answers `truncated` instead of a second
   * page, so a client-side table that swallows the flag shows a subset while
   * its own footer states a total with confidence.
   */
  it("says so when the listing was cut", async ({ expect }) => {
    const { findByTestId } = await show(listing([group()], true));

    const banner = await findByTestId("artifacts-truncated");
    expect(banner.textContent).toContain("cut at the read limit");
  });

  it("says nothing about truncation when the listing is whole", async ({
    expect,
  }) => {
    const { queryByTestId, findByText } = await show(listing([group()]));

    await findByText("1.0.0");
    expect(queryByTestId("artifacts-truncated")).toBeNull();
  });

  /**
   * One row per ARTIFACT, not per tag: the endpoint groups a tag's runtime
   * variants because that is the app page's presentation, and this page
   * unwinds it. Two runtimes under one tag are two rows here.
   */
  it("flattens a tag's runtime variants into one row each", async ({
    expect,
  }) => {
    const { findAllByText } = await show(
      listing([
        group({
          variants: [
            { ...group().variants[0], runtime: "workerd" },
            { ...group().variants[0], runtime: "node", size: 3_000_000 },
          ],
        }),
      ]),
    );

    // The tag appears once per runtime row.
    expect(await findAllByText("1.0.0")).toHaveLength(2);
    expect(await findAllByText("workerd")).toHaveLength(1);
    expect(await findAllByText("node")).toHaveLength(1);
  });

  /**
   * The filter predicate, through the real table rather than by calling it.
   *
   * `search` is the one that could not be left to `AlephaTable`'s built-in
   * field matching, which pairs a filter with the same-named property: this
   * one spans the tag AND the commit, so the page supplies a predicate and
   * that predicate owns all three filters.
   */
  it("narrows the rows on a search over tag and commit", async ({ expect }) => {
    const { findByText, queryByText, getByLabelText } = await show(
      listing([
        group({ tag: "1.0.0" }),
        group({
          app: "web",
          tag: "2.5.0",
          commitSha: "beefcafe0000000",
          variants: [{ ...group().variants[0], app: "web", tag: "2.5.0" }],
        }),
      ]),
    );

    await findByText("1.0.0");
    await findByText("2.5.0");

    fireEvent.change(getByLabelText("Search a tag or a commit"), {
      target: { value: "2.5" },
    });

    // The table debounces its refetch, so the assertion has to wait rather
    // than read the frame the keystroke landed in.
    await waitFor(() => expect(queryByText("1.0.0")).toBeNull(), {
      timeout: 5_000,
    });
    expect(queryByText("2.5.0")).toBeTruthy();

    // And the commit half of the same predicate: a query matching no tag but
    // a commit still keeps its row.
    fireEvent.change(getByLabelText("Search a tag or a commit"), {
      target: { value: "beefcafe" },
    });
    await waitFor(() => expect(queryByText("2.5.0")).toBeTruthy(), {
      timeout: 5_000,
    });
    expect(queryByText("1.0.0")).toBeNull();
  });

  /**
   * Tag equality is the whole join - no join table, no foreign key - and an
   * artifact whose tag names no release is a normal state, so the cell has to
   * read as text rather than as a link that goes nowhere.
   */
  it("links a tag to its release only when one exists", async ({ expect }) => {
    const withRelease = await show(listing([group()]), [
      {
        id: 1,
        projectId: 1,
        number: 1,
        tag: "1.0.0",
        title: "1.0.0",
        description: "",
        createdAt: "2026-08-26T10:00:00.000Z",
        updatedAt: "2026-08-26T10:00:00.000Z",
        progress: { completed: 0, inProgress: 0, shelved: 0, total: 0 },
      },
    ]);
    const tagged = await withRelease.findByText("1.0.0");
    expect(tagged.closest("a")?.getAttribute("href")).toBe(
      "/alepha/releases/1.0.0",
    );

    const withoutRelease = await show(listing([group()]), []);
    const plain = await withoutRelease.findByText("1.0.0");
    expect(plain.closest("a")).toBeNull();
  });
});
