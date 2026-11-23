import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import type { CapabilityKey } from "../../../../../api/schemas/capabilityKeySchema.ts";
import { projectFixture } from "../../../../../testing/projectFixture.ts";
import { virtualClientFake } from "../../../../../testing/virtualClientFake.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { CapabilityRowRegistry } from "../../../registries/CapabilityRowRegistry.ts";
import { ProjectBlockerRegistry } from "../../../registries/ProjectBlockerRegistry.ts";
import { ProjectShellRegistry } from "../../../registries/ProjectShellRegistry.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectSettingsCapabilitiesPage from "./ProjectSettingsCapabilitiesPage.tsx";

interface SetCapabilityCall {
  params: { projectId: number; key: string };
  body: { enabled: boolean; options?: Record<string, boolean> };
}

/**
 * Stands in for the HTTP-backed client the switches write through
 * (`AGENTS.md`: never `vi.mock`).
 */
class FakeLinkProvider extends LinkProvider {
  calls: SetCapabilityCall[] = [];

  // matches the real client's own loose virtual-action shape
  override client(): any {
    const setCapability: any = async (config: SetCapabilityCall) => {
      this.calls.push(config);
      return projectFixture({ capabilities: ["plan", "remember"] });
    };
    return virtualClientFake({ setCapability });
  }
}

/**
 * Settings > General > Capabilities, the switches only a capability with no
 * settings page of its own lists here.
 */
describe("the Capabilities settings page", () => {
  const mount = async (
    capabilities: CapabilityKey[],
    options?: Partial<Record<CapabilityKey, Record<string, boolean>>>,
  ) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      // The catalogue itself, so the switches are found by their labels.
      .with(I18n)
      // What the page and its sections inject, empty: no module registers.
      .with(ProjectShellRegistry)
      .with(ProjectBlockerRegistry)
      .with(CapabilityRowRegistry);
    await alepha.start();
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ capabilities, options }),
    );
    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectSettingsCapabilitiesPage />
      </AlephaContext.Provider>,
    );
    return { fake: alepha.inject(FakeLinkProvider), view };
  };

  it("opens with General: Activity, Chat and Reports, above the pillars (#Q4007)", async ({
    expect,
  }) => {
    const { view } = await mount(["plan", "activity", "reports"]);

    await view.findByRole("switch", { name: "Activity" });
    const names = view
      .getAllByRole("switch")
      .map((it) => it.getAttribute("aria-label"));
    expect(names.slice(0, 4)).toEqual(["Activity", "Chat", "Reports", "Plan"]);
    expect(
      view.getByRole("switch", { name: "Chat" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(
      view
        .getByRole("switch", { name: "Reports" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    // No "General" heading above the card (#Q4046): the tab is under General.
    expect(view.container.textContent).not.toContain("General");
  });

  it("turns Activity off with its own switch", async ({ expect }) => {
    const { fake, view } = await mount(["plan", "activity", "reports"]);

    fireEvent.click(await view.findByRole("switch", { name: "Activity" }));

    await waitFor(() => expect(fake.calls).toHaveLength(1));
    expect(fake.calls[0]?.params).toEqual({ projectId: 1, key: "activity" });
    expect(fake.calls[0]?.body.enabled).toBe(false);
  });

  it("lists Build's Repositories and Quality switches, each on its own (#Q4005)", async ({
    expect,
  }) => {
    const { view } = await mount(["build"], {
      build: { repositories: true, quality: false },
    });

    const repositories = await view.findByRole("switch", {
      name: "Repositories",
    });
    expect(repositories.getAttribute("aria-checked")).toBe("true");
    expect(
      view
        .getByRole("switch", { name: "Quality" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("lists Ship's options in the order of dependence (#Q4006)", async ({
    expect,
  }) => {
    const { view } = await mount(["ship"]);

    await view.findByRole("switch", { name: "Track apps" });
    const names = view
      .getAllByRole("switch")
      .map((it) => it.getAttribute("aria-label"));
    const ship = names.slice(
      names.indexOf("Ship") + 1,
      names.indexOf("Ship") + 5,
    );
    expect(ship).toEqual([
      "Track apps",
      "Monitor apps",
      "Deploy apps",
      "Deploy stacks",
    ]);
  });

  it("turns Build on with both options, as the wizard preselects them", async ({
    expect,
  }) => {
    const { fake, view } = await mount(["plan"]);

    fireEvent.click(await view.findByRole("switch", { name: "Build" }));

    await waitFor(() =>
      expect(fake.calls).toEqual([
        {
          params: { projectId: 1, key: "build" },
          body: {
            enabled: true,
            options: { repositories: true, quality: true },
          },
        },
      ]),
    );
  });
});
