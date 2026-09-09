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

describe("ReleaseArtifactsTab", () => {
  it("shows a copyable docker pull beside the tarballs", async ({ expect }) => {
    const { findByTestId, container } = await show([
      {
        app: "lore",
        tag: "0.30.0",
        pushedAt: "2026-09-09T10:00:00.000Z",
        variants: [
          variant(),
          variant({
            id: "00000000-0000-4000-8000-000000000002",
            format: "image",
            reference: "ghcr.io/alepha-dev/lore:0.30.0",
            sha256: "b".repeat(64),
            size: undefined,
          }),
        ],
      } as ArtifactGroup,
    ]);

    const pull = await findByTestId("artifact-pull");
    expect(pull.getAttribute("title")).toBe(
      "docker pull ghcr.io/alepha-dev/lore:0.30.0",
    );
    // ⚠️ Two variants sharing a runtime used to collide into one key AND read
    // as two identical "node" chips.
    expect(container.textContent).toContain("node image");
    // The ARCHIVE's digest, not whichever variant sorted first.
    expect(container.textContent).toContain("a".repeat(12));
    // The one variant that has a size, never `NaN MB`.
    expect(container.textContent).toContain("4.4 MB");
    expect(container.textContent).not.toContain("NaN");
    // The row reads correctly with nothing to download, which is what it has
    // always had: there is no Download button on any variant anywhere.
    expect(container.textContent).not.toContain("Download");
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
