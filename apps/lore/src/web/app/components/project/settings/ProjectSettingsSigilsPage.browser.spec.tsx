import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import {
  defaultProjectFeatures,
  type ProjectFeatures,
} from "@/api/entities/projects.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectSettingsSigilsPage from "./ProjectSettingsSigilsPage.tsx";

interface UpdateCall {
  params: { id: number };
  body: { features: Partial<ProjectFeatures> };
}

const aProject = {
  id: 1,
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
  title: "Lore",
  slug: "lore",
  createdBy: "00000000-0000-4000-8000-000000000001",
  areas: [],
  features: { ...defaultProjectFeatures, sigils: false },
  kanbanColumns: ["In Progress"],
  unlockedFeatures: [],
  unlockHistory: [],
};

/**
 * Stands in for the HTTP-backed `useClient<ProjectController>()` that
 * `useProjectFeatureToggle` writes through (`CLAUDE.md`: never `vi.mock`).
 */
class FakeLinkProvider extends LinkProvider {
  calls: UpdateCall[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {
      updateProjectById: async (config: UpdateCall) => {
        this.calls.push(config);
        return {
          ...aProject,
          features: { ...aProject.features, ...config.body.features },
        };
      },
    };
  }
}

/**
 * The page after #1770 gutted it: a switch and the ignore rules.
 *
 * The case that matters is the KEY. The label says "Apps" and the column says
 * `sigils`, and those two must stay apart: the flag is `.optional()`, so
 * renaming it would not fail to decode the way `projects.features` did on
 * 2026-08-05 - it would silently read `undefined` for every project that had
 * the module on, turning it off while the old value sat in the JSON column.
 */
describe("the Apps settings page", () => {
  const mount = async () => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      // Before the modules that reach for it - a substitution after
      // `LinkProvider` has been instantiated is a `TooLateSubstitutionError`.
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      // The catalogue itself. Without it `tr()` echoes the key, so the copy
      // assertion below would pass against the key name and prove nothing.
      .with(I18n);
    await alepha.start();
    alepha.store.set(currentProjectAtom, aProject as never);

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectSettingsSigilsPage />
      </AlephaContext.Provider>,
    );

    return { alepha, fake: alepha.inject(FakeLinkProvider), view };
  };

  it("writes `sigils`, whatever the label says", async ({ expect }) => {
    const { alepha, fake, view } = await mount();

    fireEvent.click(await view.findByRole("switch"));

    await waitFor(() =>
      expect(fake.calls).toEqual([
        { params: { id: 1 }, body: { features: { sigils: true } } },
      ]),
    );
    await waitFor(() =>
      expect(alepha.store.get(currentProjectAtom)?.features?.sigils).toBe(true),
    );
  });

  it("offers no way to enrol a credential from here", async ({ expect }) => {
    // The enrol block and the credential list are gone (#1770): creating a
    // deployed copy is what `/apps` is for, and a sigil is an unlock on one of
    // those. A second door onto the same room is what this quest closed.
    const { view } = await mount();

    fireEvent.click(await view.findByRole("switch"));

    await waitFor(() =>
      expect(view.container.textContent).toContain("Ignore rules"),
    );
    expect(view.container.textContent).not.toMatch(/enrol/i);
    expect(view.container.textContent).not.toMatch(/sg_/);
  });

  it("explains the switch from the catalogue, not from its key", async ({
    expect,
  }) => {
    const { view } = await mount();

    // The dictionaries are `lazy`, one dynamic import per locale, so the first
    // paint carries keys rather than copy.
    await waitFor(() =>
      expect(view.container.textContent).toMatch(/one row per app/i),
    );

    expect(view.container.textContent).not.toContain(
      "project.settings.feature.sigils",
    );
    // The copy this quest replaced. Every clause of it was stale: a sigil is
    // optional now, and it belongs to one deployed copy rather than to an app.
    expect(view.container.textContent).not.toContain("one token per app");
  });
});
