import type { NavGroup } from "@alepha/ui/components/app-shell/app-shell";
import { render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";
import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";

import { currentInstancesAtom } from "../../atoms/currentInstancesAtom.ts";
import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { projectNavAtom } from "../../atoms/projectNavAtom.ts";
import ProjectViewNavPublisher from "./ProjectViewNavPublisher.tsx";

class Routes {
  app = $page({
    name: "app",
    path: "/:projectSlug/apps/:app/:env",
    component: () => null,
  });
}

const aProject = {
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
};

let seq = 0;
const anInstance = (app: string, env: string): AppInstanceResource =>
  ({
    id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    projectId: 1,
    app,
    env,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  }) as AppInstanceResource;

/**
 * The sidebar as `ProjectView` builds it since #1771: Apps is one entry with a
 * destination of its own and no children.
 */
const aNav: NavGroup[] = [
  {
    items: [
      { label: "Quests", href: "/alepha/quests" },
      { label: "Apps", href: "/alepha/apps" },
    ],
  },
];

describe("what the palette is offered", () => {
  const mount = async (instances: AppInstanceResource[] | undefined) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    await alepha.start();

    alepha.store.set(currentProjectAtom, aProject as never);
    alepha.store.set(currentInstancesAtom, instances as never);

    render(
      <AlephaContext.Provider value={alepha}>
        <ProjectViewNavPublisher nav={aNav} />
      </AlephaContext.Provider>,
    );

    return alepha;
  };

  /**
   * ⚠️ The regression this spec exists for. Instances used to BE sidebar
   * children, so flattening the nav produced them for free; #1771 collapsed
   * that group, and without an explicit append every app would have dropped out
   * of ⌘K in the same commit that removed them from the sidebar, leaving the
   * list page as the only door to one.
   */
  it("keeps instances after the sidebar stopped listing them", async ({
    expect,
  }) => {
    const alepha = await mount([
      anInstance("club", "production"),
      anInstance("club", "b14-production"),
    ]);

    await waitFor(() =>
      expect(alepha.store.get(projectNavAtom)).toEqual([
        { label: "Quests", href: "/alepha/quests", kind: "page" },
        { label: "Apps", href: "/alepha/apps", kind: "page" },
        {
          label: "club / production",
          href: "/alepha/apps/club/production",
          kind: "app",
        },
        {
          label: "club / b14-production",
          href: "/alepha/apps/club/b14-production",
          kind: "app",
        },
      ]),
    );
  });

  it("renders both halves, so siblings are not identical rows", async ({
    expect,
  }) => {
    // `matchProjectNav` matches on the label, so typing `b14` has to find one.
    const alepha = await mount([
      anInstance("club", "production"),
      anInstance("club", "staging"),
    ]);

    await waitFor(() => {
      const labels = (alepha.store.get(projectNavAtom) ?? [])
        .filter((entry) => entry.kind === "app")
        .map((entry) => entry.label);
      expect(labels).toEqual(["club / production", "club / staging"]);
    });
  });

  it("offers pages only when the list could not be read", async ({
    expect,
  }) => {
    // `undefined` is the could-not-read state. Offering nothing is the honest
    // answer in the palette; the list page is where it says why.
    const alepha = await mount(undefined);

    await waitFor(() =>
      expect(
        (alepha.store.get(projectNavAtom) ?? []).filter(
          (entry) => entry.kind === "app",
        ),
      ).toEqual([]),
    );
  });
});
