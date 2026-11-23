import {
  ProjectSettingsCapabilitiesPage,
  projectFixture,
  virtualClientFake,
} from "@lore/core/testing";
import {
  CapabilityRowRegistry,
  currentProjectAtom,
  I18n,
  ProjectBlockerRegistry,
} from "@lore/core/web";
import { RequirementsShell } from "@lore/plan-requirements/web";
import { WorkShell } from "@lore/plan/web";
import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({});
  }
}

/**
 * The Roadmap switch lives on General > Capabilities, under Plan, right
 * after Requirements (#Q4184), and nowhere else.
 */
describe("the Roadmap switch on Capabilities", () => {
  it("is listed under Plan, right after Requirements", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n)
      .with(ProjectBlockerRegistry)
      .with(CapabilityRowRegistry)
      .with(WorkShell)
      .with(RequirementsShell);
    await alepha.start();
    alepha.store.set(currentProjectAtom, projectFixture());

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectSettingsCapabilitiesPage />
      </AlephaContext.Provider>,
    );

    const switches = (await view.findAllByRole("switch")).map((it) =>
      it.getAttribute("aria-label"),
    );
    const roadmap = switches.indexOf("Roadmap");
    expect(roadmap).toBeGreaterThan(0);
    expect(switches[roadmap - 1]).toBe("Requirements");
    expect(switches.filter((it) => it === "Roadmap")).toHaveLength(1);

    await alepha.stop();
  });
});
