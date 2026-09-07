import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { describe, it } from "vitest";

import { projectFixture } from "@/testing/projectFixture.ts";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { canInProject } from "../../services/projectRank.ts";
import { useRank } from "./useRank.ts";

/**
 * The probe every write control in the project UI gates on.
 *
 * ⚠️ The case that matters is the third: **a custom Admin rank sees the button
 * the server allows.** Before ranks, every one of those controls asked
 * `member?.owner` or compared `project.createdBy` to the viewer, so an Admin
 * would have held the permission server-side and found the button hidden -
 * the feature broken in the way that is hardest to diagnose, because the API
 * works when you curl it and every server test passes.
 */
const Probe = (props: { permission: string }) => {
  const { can, rank } = useRank();
  return (
    <div>
      <span data-testid="answer">{String(can(props.permission))}</span>
      <span data-testid="rank">{rank?.name ?? "none"}</span>
    </div>
  );
};

const mount = async (
  project: ReturnType<typeof projectFixture> | undefined,
  permission: string,
) => {
  const alepha = Alepha.create().with(AlephaReact);
  await alepha.start();
  alepha.store.set(currentProjectAtom, project as never);

  const view = render(
    <AlephaContext.Provider value={alepha}>
      <Probe permission={permission} />
    </AlephaContext.Provider>,
  );

  // Scoped to THIS render's own container, not the document: several mounts
  // share one jsdom body inside a case, and `getByTestId` would find them all.
  return view.container.querySelector('[data-testid="answer"]')?.textContent;
};

describe("useRank", () => {
  it("answers from the effective set the server computed", async ({
    expect,
  }) => {
    const viewer = projectFixture({
      permissions: ["project:read", "quest:read"],
      rank: { key: "viewer", name: "Viewer" },
    });

    await expect(mount(viewer, "quest:read")).resolves.toBe("true");
    await expect(mount(viewer, "quest:create")).resolves.toBe("false");
  });

  it("reads the owner's wildcard", async ({ expect }) => {
    // `["*"]` rather than the enumerated set: an owner listed permission by
    // permission falls behind every time a new one is declared.
    await expect(mount(projectFixture(), "sigil:manage")).resolves.toBe("true");
  });

  it("gives a custom Admin rank the button the server allows", async ({
    expect,
  }) => {
    // The whole point of the epic, as one assertion. `admin` is a rank
    // somebody created; nothing about it is `owner`, and the old
    // `member?.owner` probe would have answered false for every one of these.
    const admin = projectFixture({
      permissions: [
        "project:read",
        "project:update",
        "member:manage",
        "rank:manage",
        "app:manage",
        "sigil:manage",
      ],
      rank: { key: "admin", name: "Admin" },
    });

    for (const permission of [
      "app:manage",
      "sigil:manage",
      "member:manage",
      "rank:manage",
    ]) {
      await expect(mount(admin, permission)).resolves.toBe("true");
    }

    // And still not the two acts that are the owner's structurally.
    await expect(mount(admin, "project:delete")).resolves.toBe("false");
    await expect(mount(admin, "capability:manage")).resolves.toBe("false");
  });

  it("hides everything when the project has no set at all", ({ expect }) => {
    // A response that dropped the field, or a project loaded before it
    // existed. Hiding controls is the safe direction: the alternative is
    // offering ones the server will refuse.
    expect(canInProject(undefined, "project:read")).toBe(false);
    expect(canInProject({ permissions: undefined }, "project:read")).toBe(
      false,
    );
  });

  it("names the rank without gating on it", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaReact);
    await alepha.start();
    alepha.store.set(
      currentProjectAtom,
      projectFixture({
        permissions: ["project:read"],
        rank: { key: "custom-1", name: "Reviewer" },
      }) as never,
    );

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <Probe permission="project:read" />
      </AlephaContext.Provider>,
    );

    // A custom rank shows its own name, which is why the badge reads the rank
    // rather than a boolean.
    expect(
      view.container.querySelector('[data-testid="rank"]')?.textContent,
    ).toBe("Reviewer");
  });
});
