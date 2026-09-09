import { cleanup, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import AppArtifacts from "./AppArtifacts.tsx";

/**
 * Records every action the page reaches for and answers what a case set.
 * Same substitution seam as `AppDashboard.browser.spec.tsx` (`CLAUDE.md`:
 * never `vi.mock` / `vi.spyOn`).
 */
class RecordingLinkProvider extends LinkProvider {
  public calls: string[] = [];
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

const instanceOf = (
  over: Partial<AppInstanceResource> = {},
): AppInstanceResource => ({
  id: "00000000-0000-4000-8000-000000000010",
  projectId: 1,
  app: "docs",
  env: "production",
  ephemeral: false,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  ...over,
});

/**
 * The Artifacts tab (feedback #2065): the card that used to close the
 * Dashboard, given a tab and the width. These cases moved here with it; the
 * one listing the page issues moved with them, since the Dashboard is back to
 * asking for nothing.
 */
describe("AppArtifacts", () => {
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
    instance: AppInstanceResource,
    responses: Record<string, unknown> = {},
  ) => {
    cleanup();
    const alepha = await mount();
    alepha.store.set(currentInstanceAtom, instance as never);
    // The list reads the project for its id and its slug, so without this it
    // would stay disabled and every case below would pass by not running the
    // code it is about.
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ title: "Alepha", slug: "alepha" }) as never,
    );
    const links = alepha.inject(LinkProvider) as RecordingLinkProvider;
    links.responses = responses;
    return {
      links,
      ...render(
        <AlephaContext.Provider value={alepha}>
          <AppArtifacts />
        </AlephaContext.Provider>,
      ),
    };
  };

  const listing = (groups: unknown[]) => ({
    listArtifacts: { groups, truncated: false },
  });

  /**
   * One indexed read of a small table, and nothing from Analytics Engine: the
   * tab shares the Dashboard's cost class, not Analytics'. Written as an exact
   * list so an insights call cannot creep in unnoticed.
   */
  it("issues one artifact listing and no analytics query", async ({
    expect,
  }) => {
    const { links, getByTestId } = await show(instanceOf(), listing([]));

    expect(getByTestId("app-artifacts")).toBeTruthy();
    // Awaited: the listing is an effect, so asserting synchronously would
    // read an empty array and pass for the wrong reason.
    await waitFor(() => expect(links.calls).toEqual(["listArtifacts"]));
  });

  /**
   * ⚠️ Empty is a normal, and often permanent, state here. Everything else
   * under this app is derived from telemetry the app itself pushes; artifacts
   * come from CI, a second foreign system that can be absent entirely. An
   * error or an ominous blank would report a fault where there is none.
   */
  it("tells an app with no pipeline where to read how", async ({ expect }) => {
    const { findByText, getByTestId } = await show(instanceOf(), listing([]));

    expect(await findByText(/No artifacts pushed yet/)).toBeTruthy();

    // The same link the project page carries, and the same reason it is
    // asserted whole: root-relative it 404s (feedback #P2142). The command
    // this panel used to print moved into that page (feedback #P2154).
    const docs = getByTestId("artifacts-empty-docs") as HTMLAnchorElement;
    expect(docs.getAttribute("href")).toBe(
      "https://alepha.dev/lore/docs/guides-artifacts",
    );
    expect(getByTestId("app-artifacts").textContent).not.toContain(
      "lore artifacts push",
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
      instanceOf(),
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
              format: "archive",
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
              format: "archive",
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

  /**
   * ⚠️ Three things broke on this row when `format` joined the key, and all
   * three were silent.
   *
   * The badge key was `variant.runtime`, so a node tarball and a node image
   * of one tag collided into ONE React key and read as two identical "node"
   * chips. The digest was `variants[0]`, which after a `(runtime, format)`
   * sort is the archive by luck rather than by decision, and would flip the
   * day a `bun` image joined a `node` archive. And `Math.max` over the sizes
   * is `NaN` the moment one variant has none.
   */
  it("tells a node archive from a node image, and shows the archive's digest", async ({
    expect,
  }) => {
    const { findByText, getByTestId } = await show(
      instanceOf(),
      listing([
        {
          app: "docs-production",
          tag: "0.30.0",
          pushedAt: "2026-09-09T10:00:00.000Z",
          variants: [
            {
              id: "00000000-0000-4000-8000-000000000020",
              projectId: 1,
              app: "docs-production",
              tag: "0.30.0",
              runtime: "node",
              format: "archive",
              sha256: "a".repeat(64),
              size: 4_400_000,
              createdAt: "2026-09-09T10:00:00.000Z",
              updatedAt: "2026-09-09T10:00:00.000Z",
            },
            {
              id: "00000000-0000-4000-8000-000000000021",
              projectId: 1,
              app: "docs-production",
              tag: "0.30.0",
              runtime: "node",
              format: "image",
              reference: "ghcr.io/acme/docs:0.30.0",
              sha256: "b".repeat(64),
              // No size at all: an image's is best effort.
              createdAt: "2026-09-09T10:00:00.000Z",
              updatedAt: "2026-09-09T10:00:00.000Z",
            },
          ],
        },
      ]),
    );

    expect(await findByText("0.30.0")).toBeTruthy();
    const card = getByTestId("app-artifacts").textContent ?? "";
    // Two distinct chips, not two identical "node" ones.
    expect(card).toContain("node image");
    // The ARCHIVE's digest, decided rather than sorted into place.
    expect(card).toContain("a".repeat(12));
    expect(card).not.toContain("b".repeat(12));
    // The one variant that HAS a size, and never `NaN MB`.
    expect(card).toContain("4.4 MB");
    expect(card).not.toContain("NaN");
  });

  it("shows N/A when no variant under the tag states a size", async ({
    expect,
  }) => {
    const { findByText, getByTestId } = await show(
      instanceOf(),
      listing([
        {
          app: "docs-production",
          tag: "0.31.0",
          pushedAt: "2026-09-09T10:00:00.000Z",
          variants: [
            {
              id: "00000000-0000-4000-8000-000000000022",
              projectId: 1,
              app: "docs-production",
              tag: "0.31.0",
              runtime: "node",
              format: "image",
              reference: "ghcr.io/acme/docs:0.31.0",
              sha256: "c".repeat(64),
              createdAt: "2026-09-09T10:00:00.000Z",
              updatedAt: "2026-09-09T10:00:00.000Z",
            },
          ],
        },
      ]),
    );

    expect(await findByText("0.31.0")).toBeTruthy();
    const card = getByTestId("app-artifacts").textContent ?? "";
    expect(card).toContain("N/A");
    expect(card).not.toContain("NaN");
  });

  it("shows no commit when the push named none", async ({ expect }) => {
    const { findByText, getByTestId } = await show(
      instanceOf(),
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
              format: "archive",
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
