import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { ScopeGrantsProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import type { AreaResource } from "@/api/schemas/areaResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";

import { currentProjectAtom } from "../../atoms/currentProjectAtom.ts";
import { I18n } from "../../services/I18n.ts";
import { ProjectScopeGrants } from "../../services/ProjectScopeGrants.ts";
import ProjectEpicFolios from "./epics/ProjectEpicFolios.tsx";
import ProjectSettingsAreasPage from "./settings/ProjectSettingsAreasPage.tsx";

/**
 * The whole chain of #Q1958, end to end, with nothing faked in the middle.
 *
 * The other browser specs in this folder substitute `LinkProvider` so their
 * subject has a client to call. That is exactly what cannot be done here: the
 * mechanism under test IS `LinkProvider.can()`, so a fake answering `true`
 * would assert the fake. This one uses the real provider and seeds the real
 * registry atom instead - the same payload `GET /api/_links` returns, with
 * the `permissions` field #Q1957 added - so the four links in the chain are
 * all genuine:
 *
 * 1. the action declares its requirement (here: as the registry states it),
 * 2. `ProjectScopeGrants` reads the project's effective set off the atom,
 * 3. `LinkProvider.can()` narrows the first by the second,
 * 4. the component hides its control.
 *
 * Break any one and these cases go red, which is the point: the sweep is 30
 * files of `{api.x.can() && <Button/>}`, and what makes those honest is that
 * `can()` answers differently for a Viewer than for an Owner.
 */
const REGISTRY = {
  prefix: "/api",
  actions: {
    attachFolio: { path: "/epics/:id/folios", method: "POST" },
    deleteArea: { path: "/areas/:id", method: "DELETE" },
    mergeAreas: { path: "/areas/merge", method: "POST" },
  } as Record<string, { path: string; method: string; permissions?: string[] }>,
};

const registryWith = (permissions: Record<string, string[]>) => ({
  ...REGISTRY,
  actions: Object.fromEntries(
    Object.entries(REGISTRY.actions).map(([name, action]) => [
      name,
      { ...action, permissions: permissions[name] },
    ]),
  ),
});

class Routes {
  folio = $page({
    name: "projectFoliosFolio",
    path: "/folios/:shortId",
    component: () => null,
  });

  area = $page({
    name: "projectSettingsArea",
    path: "/settings/areas/:areaId",
    component: () => null,
  });
}

const anArea = (id: number, name: string): AreaResource =>
  ({
    id,
    projectId: 1,
    name,
    description: "",
    questCount: 0,
    lastQuestAt: undefined,
  }) as unknown as AreaResource;

const aFolio = {
  id: "folio-1",
  shortId: 7,
  title: "The one folio",
} as never;

describe("write controls under a rank", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (permissions: string[]) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // What `LoreWebApp.register()` does in the app. Before `AlephaReact`,
      // for the reason every other spec here substitutes early.
      .with({ provide: ScopeGrantsProvider, use: ProjectScopeGrants })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(AlephaReactRouter);
    alepha.inject(Routes);
    alepha.inject(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");

    alepha.store.set(
      "alepha.server.request.apiLinks",
      registryWith({
        attachFolio: ["epic:write"],
        deleteArea: ["area:manage"],
        mergeAreas: ["area:manage"],
      }) as never,
    );
    alepha.store.set(
      currentProjectAtom,
      projectFixture({
        permissions,
        rank: { key: "viewer", name: "Viewer" },
      }) as never,
    );

    return render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <ProjectEpicFolios
            projectId={1}
            folios={[aFolio]}
            onAttach={() => {}}
            onDetach={() => {}}
          />
          <ProjectSettingsAreasPage areas={[anArea(1, "lore/ui")]} />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  const OWNER = ["epic:write", "area:manage", "folio:read", "area:read"];
  const VIEWER = ["project:read", "folio:read", "area:read", "epic:read"];

  it("shows the writes to a rank that holds them", async ({ expect }) => {
    const view = await mount(OWNER);

    // The epic's Folios tab: the picker that attaches, and the row's detach.
    expect(view.queryByLabelText("Detach")).not.toBeNull();
    // The areas table: the delete on an area holding no quests.
    expect(view.queryByText("Delete")).not.toBeNull();
  });

  it("hides every one of them from a Viewer", async ({ expect }) => {
    const view = await mount(VIEWER);

    expect(view.queryByLabelText("Detach")).toBeNull();
    expect(view.queryByText("Delete")).toBeNull();
  });

  it("leaves the read surface intact", async ({ expect }) => {
    const view = await mount(VIEWER);

    // The whole point of a Viewer: everything is still there to read. The
    // folio is still a link, the area is still a row with its stats, and
    // neither list has collapsed into an empty state.
    expect(view.container.textContent).toContain("The one folio");
    expect(view.container.textContent).toContain("lore/ui");
    expect(view.queryByRole("link", { name: "The one folio" })).not.toBeNull();
  });

  it("narrows per project, not per session", async ({ expect }) => {
    const view = await mount(VIEWER);

    // The same container, the same registry, the same signed-in user: only
    // the project's effective set moved. This is what a fake `can()` cannot
    // express, and what the substitution exists for.
    expect(view.queryByText("Delete")).toBeNull();

    alepha?.store.set(
      currentProjectAtom,
      projectFixture({ permissions: OWNER }) as never,
    );

    expect(alepha?.inject(ProjectScopeGrants).current()).toEqual(OWNER);
  });
});
