import { cleanup, render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { describe, it } from "vitest";

import type { ArtifactGroup } from "@/api/schemas/artifactGroupSchema.ts";

import { I18n } from "../../../services/I18n.ts";
import ReleaseArtifactsTab from "./ReleaseArtifactsTab.tsx";

/**
 * The release page's Artifacts tab, once a tag can carry an image.
 *
 * The question this tab exists to answer is "what shipped as 0.30.0", and
 * until epic #E47 it could only answer it for things Lore stored bytes of.
 * The `docker pull` line is the other half of that answer, and the two cases
 * below are the ones that were silently wrong before: two variants sharing a
 * runtime collided into one React key, and `Math.max` over their sizes was
 * `NaN` the moment one of them had none.
 */
const variant = (over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  projectId: 1,
  app: "lore",
  tag: "0.30.0",
  runtime: "node",
  format: "archive",
  sha256: "a".repeat(64),
  size: 4_400_000,
  createdAt: "2026-09-09T10:00:00.000Z",
  updatedAt: "2026-09-09T10:00:00.000Z",
  ...over,
});

const show = async (artifacts: ArtifactGroup[]) => {
  cleanup();
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaLogger)
    .with(AlephaDateTime)
    .with(AlephaReact)
    // ⚠️ Not optional even with no catalogue of its own: `@alepha/ui` needs
    // the module, SSR renders fine without it and only hydration dies.
    .with(AlephaReactI18n)
    .with(I18n);

  await alepha.start();

  return render(
    <AlephaContext.Provider value={alepha}>
      <ReleaseArtifactsTab tag="0.30.0" artifacts={artifacts} />
    </AlephaContext.Provider>,
  );
};

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

/**
 * The first three cells of every row, app / format / runtime, as read.
 */
const cellsOf = (rows: HTMLElement[]) =>
  rows.map((row) =>
    [...row.children].slice(0, 3).map((cell) => cell.textContent?.trim()),
  );

describe("ReleaseArtifactsTab", () => {
  it("gives every variant its own row, digest and size", async ({ expect }) => {
    const { findAllByTestId, findByTestId, container } = await show([
      {
        app: "lore",
        tag: "0.30.0",
        pushedAt: "2026-09-09T10:00:00.000Z",
        variants: [
          variant(),
          variant({
            id: id(2),
            format: "image",
            reference: "ghcr.io/alepha-dev/lore:0.30.0",
            sha256: "b".repeat(64),
            size: undefined,
          }),
        ],
      } as ArtifactGroup,
    ]);

    const [archive, image] = (
      await findAllByTestId("release-artifact-row")
    ).map((row) => row.textContent ?? "");
    expect(archive).toContain("a".repeat(12));
    expect(archive).toContain("4.4 MB");
    // ⚠️ Grouped by app, the row showed the ARCHIVE's digest only, so the
    // image's own digest was nowhere on the page.
    expect(image).toContain("b".repeat(12));
    // Its own size, which it does not have: N/A, never the tarball's.
    expect(image).toContain("N/A");
    expect(image).not.toContain("4.4 MB");

    // The image row keeps its registry reference, copyable as a pull.
    const pull = await findByTestId("artifact-pull");
    expect(pull.getAttribute("title")).toBe(
      "docker pull ghcr.io/alepha-dev/lore:0.30.0",
    );
    expect(image).toContain("ghcr.io/alepha-dev/lore:0.30.0");
    expect(archive).not.toContain("ghcr.io");
    expect(container.textContent).not.toContain("NaN");
    // The row reads correctly with nothing to download, which is what it has
    // always had: there is no Download button on any variant anywhere.
    expect(container.textContent).not.toContain("Download");
  });

  it("orders rows by app, format and runtime, and names workerd cloudflare", async ({
    expect,
  }) => {
    // The five rows of feedback #P2193, handed over grouped and out of order.
    const { findAllByTestId, container } = await show([
      {
        app: "lore",
        tag: "0.30.0",
        pushedAt: "2026-09-09T10:00:00.000Z",
        variants: [
          variant({ id: id(1), runtime: "workerd" }),
          variant({
            id: id(2),
            format: "image",
            reference: "ghcr.io/alepha-dev/lore:0.30.0",
          }),
          variant({ id: id(3) }),
        ],
      } as ArtifactGroup,
      {
        app: "docs",
        tag: "0.30.0",
        pushedAt: "2026-09-09T10:00:00.000Z",
        variants: [
          variant({ id: id(4), app: "docs", runtime: "workerd" }),
          variant({ id: id(5), app: "docs" }),
        ],
      } as ArtifactGroup,
    ]);

    expect(cellsOf(await findAllByTestId("release-artifact-row"))).toEqual([
      ["docs", "archive", "node"],
      ["docs", "archive", "cloudflare"],
      ["lore", "archive", "node"],
      ["lore", "archive", "cloudflare"],
      ["lore", "image", "node"],
    ]);
    // The stored value is a key across the stack; only the label moved.
    expect(container.textContent).not.toContain("workerd");
  });

  it("renders N/A rather than NaN when the only variant is a sizeless image", async ({
    expect,
  }) => {
    const { container } = await show([
      {
        app: "lore",
        tag: "0.30.0",
        pushedAt: "2026-09-09T10:00:00.000Z",
        variants: [
          variant({
            format: "image",
            reference: "ghcr.io/alepha-dev/lore:0.30.0",
            size: undefined,
          }),
        ],
      } as ArtifactGroup,
    ]);

    expect(container.textContent).toContain("N/A");
    expect(container.textContent).not.toContain("NaN");
  });

  it("offers no pull command for a tag that is only a tarball", async ({
    expect,
  }) => {
    const { queryByTestId } = await show([
      {
        app: "lore",
        tag: "0.30.0",
        pushedAt: "2026-09-09T10:00:00.000Z",
        variants: [variant()],
      } as ArtifactGroup,
    ]);

    expect(queryByTestId("artifact-pull")).toBeNull();
  });
});
