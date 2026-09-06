import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { $page, AlephaReactRouter } from "alepha/react/router";
import { LinkProvider } from "alepha/server/links";
import { afterEach, describe, it } from "vitest";

import type { AppInstanceResource } from "@/api/schemas/appInstanceResourceSchema.ts";
import { projectFixture } from "@/testing/projectFixture.ts";

import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import AppSettingsSigil from "./AppSettingsSigil.tsx";

class Routes {
  projectSettingsSupport = $page({
    name: "projectSettingsSupport",
    path: "/:projectSlug/settings/support",
    component: () => null,
  });
}

class FakeLinkProvider extends LinkProvider {
  override client(): any {
    return new Proxy({}, { get: () => async () => ({}) });
  }
}

const anInstance = (kinds: string[]): AppInstanceResource =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    projectId: 1,
    app: "club",
    env: "production",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    sigil: {
      id: "00000000-0000-4000-8000-000000000002",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
      projectId: 1,
      name: "club/production",
      tokenPrefix: "sg_abc",
      kinds,
    },
  }) as never;

/**
 * The disclosure for a real bug, and one this epic did not cause.
 *
 * `SigilIngestService.gatesFor` needs `apps.track` AND `support` for the
 * feedback kind, because Support also gates the first-party request form,
 * which exists with no app enrolled at all. The reporting client fails open on
 * any config error, so an app whose sigil carries `feedback` while the project
 * does not collect it **keeps sending feedback that Lore silently discards** -
 * and `absorb` stamps `lastSeenAt` for a batch every gate rejected, so the app
 * looks perfectly healthy from both ends.
 *
 * Nothing anywhere said so. This row does.
 */
describe("the sigil row's dropped-feedback notice", () => {
  const containers: Alepha[] = [];

  afterEach(async () => {
    await Promise.all(containers.splice(0).map((it) => it.stop()));
  });

  const mount = async (options: {
    kinds: string[];
    capabilities: Array<"work" | "knowledge" | "apps" | "support">;
  }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactRouter)
      .with(AlephaReactI18n)
      .with(I18n);
    alepha.inject(Routes);
    await alepha.start();
    containers.push(alepha);

    alepha.store.set(
      currentProjectAtom,
      projectFixture({ capabilities: options.capabilities }) as never,
    );
    // The full `members` row: the atom validates against the entity schema,
    // so a convenient subset is refused rather than tolerated.
    alepha.store.set(currentProjectMemberAtom, {
      id: 1,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
      projectId: 1,
      userId: "00000000-0000-4000-8000-000000000001",
      owner: true,
    } as never);
    alepha.store.set(currentInstanceAtom, anInstance(options.kinds) as never);

    // The delete row calls `useDialog`, which throws without its provider.
    // Mounted here rather than mocked: `CLAUDE.md` bans `vi.mock`, and the
    // real provider is three lines of tree.
    return render(
      <AlephaContext.Provider value={alepha}>
        <DialogProvider>
          <AppSettingsSigil />
        </DialogProvider>
      </AlephaContext.Provider>,
    );
  };

  it("says so when the app sends feedback the project drops", async ({
    expect,
  }) => {
    const view = await mount({
      kinds: ["feedback", "beacon"],
      capabilities: ["apps"],
    });

    await waitFor(() =>
      expect(view.container.textContent).toMatch(/feedback is not collected/i),
    );
  });

  it("says nothing when the project does collect it", async ({ expect }) => {
    const view = await mount({
      kinds: ["feedback"],
      capabilities: ["apps", "support"],
    });

    // The whole value of the row is that it appears only when something is
    // actually being thrown away. A notice that is always there is chrome.
    await waitFor(() => expect(view.container.textContent).toContain("sg_abc"));
    expect(view.container.textContent).not.toMatch(
      /feedback is not collected/i,
    );
  });

  it("says nothing when the app does not send feedback", async ({ expect }) => {
    const view = await mount({ kinds: ["beacon"], capabilities: ["apps"] });

    await waitFor(() => expect(view.container.textContent).toContain("sg_abc"));
    expect(view.container.textContent).not.toMatch(
      /feedback is not collected/i,
    );
  });
});
