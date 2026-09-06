import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { defaultProjectFeatures } from "@/api/entities/projects.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectSettingsQualityPage from "./ProjectSettingsQualityPage.tsx";

interface SetCapabilityCall {
  params: { projectId: number; key: string };
  body: { enabled: boolean; options?: Record<string, boolean> };
}

/**
 * A project that predates the Quality module: `features` carries no `quality`
 * key at all. That is every project created before the tab shipped, and it is
 * the case the Alepha project sat in while CI pushed runs nobody could see.
 */
const aProject = {
  id: 1,
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
  title: "Lore",
  slug: "lore",
  createdBy: "00000000-0000-4000-8000-000000000001",
  areas: [],
  features: defaultProjectFeatures,
  // Empty until the surfaces read capabilities: this spec is
  // about something else, and a fixture that claims capabilities it
  // does not exercise is a lie the next reader has to check.
  capabilities: [],
  kanbanColumns: ["In Progress"],
  unlockedFeatures: [],
  unlockHistory: [],
};

/**
 * Stands in for the HTTP-backed client that `useProjectFeatureToggle` writes
 * through. Same substitution seam as `useInviteMember.browser.spec.tsx`
 * (`CLAUDE.md`: never `vi.mock`).
 */
class FakeLinkProvider extends LinkProvider {
  calls: SetCapabilityCall[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    return {
      setCapability: async (config: SetCapabilityCall) => {
        this.calls.push(config);
        // What the real action answers: the whole project resource, so one
        // round-trip refreshes both project atoms.
        return {
          ...aProject,
          capabilities: config.body.enabled
            ? [
                {
                  key: config.params.key,
                  enabledAt: "2026-09-06T10:00:00.000Z",
                  options: config.body.options ?? {},
                },
              ]
            : [],
        };
      },
    };
  }
}

/**
 * The Quality tab is gated on `features.quality`, and until this page existed
 * nothing in the UI could set it: the tab shipped with its gate but without
 * its switch, so a project could receive pushes for days and never show them.
 */
describe("the Quality settings page", () => {
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
        <ProjectSettingsQualityPage />
      </AlephaContext.Provider>,
    );

    return { alepha, fake: alepha.inject(FakeLinkProvider), view };
  };

  /**
   * The flag is `.optional()` and outside `defaultProjectFeatures` on purpose
   * (a key there rebuilds the D1 `projects` table), so "absent" is the state
   * every existing project is in and the switch must read it as off.
   */
  it("reads as off for a project whose features carry no `quality` key", async ({
    expect,
  }) => {
    const { view } = await mount();

    const toggle = await view.findByRole("switch");

    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("turning it on writes the Apps capability", async ({ expect }) => {
    const { alepha, fake, view } = await mount();

    fireEvent.click(await view.findByRole("switch"));

    // Quality is Apps baseline now, so the switch on this page writes the
    // capability rather than a flag of its own. The page itself is on its way
    // out with the four capability pages; what is pinned here is that the one
    // control on it still reaches the one write path.
    await waitFor(() =>
      expect(fake.calls).toEqual([
        {
          params: { projectId: 1, key: "apps" },
          body: { enabled: true, options: {} },
        },
      ]),
    );
    // The atom is what the Reports tabs read, so this is the moment the tab
    // appears, with no reload in between.
    await waitFor(() =>
      expect(
        alepha.store
          .get(currentProjectAtom)
          ?.capabilities.some((it) => it.key === "apps"),
      ).toBe(true),
    );
  });

  /**
   * Every other feature page has a catalogue entry for its description, and a
   * missing one is invisible at typecheck: `tr()` renders the key.
   */
  it("explains the switch from the catalogue, not from its key", async ({
    expect,
  }) => {
    const { view } = await mount();

    // The dictionaries are `lazy`, one dynamic import per locale, so the first
    // paint carries keys rather than copy.
    await waitFor(() =>
      expect(view.container.textContent).toContain("Reports"),
    );

    expect(view.container.textContent).not.toContain(
      "project.settings.feature.quality",
    );
  });
});
