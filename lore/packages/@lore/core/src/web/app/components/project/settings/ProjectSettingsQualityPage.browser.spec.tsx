import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { LinkProvider } from "alepha/server/links";
import { describe, it } from "vitest";

import { projectFixture } from "../../../../../testing/projectFixture.ts";
import { virtualClientFake } from "../../../../../testing/virtualClientFake.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { I18n } from "../../../services/I18n.ts";
import ProjectSettingsQualityPage from "./ProjectSettingsQualityPage.tsx";

class FakeLinkProvider extends LinkProvider {
  // matches the real client's own loose virtual-action shape
  override client(): any {
    return virtualClientFake({
      getProjectThresholds: async () => ({ coverageMin: 70 }),
    });
  }
}

/**
 * General > Quality (#Q4059): the coverage target and the coverage alert,
 * which sat on Ship's Features tab until Quality moved to Build.
 */
describe("ProjectSettingsQualityPage", () => {
  it("holds the coverage target and the coverage alert", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with({ provide: LinkProvider, use: FakeLinkProvider })
      .with(AlephaReact)
      .with(AlephaReactI18n)
      .with(I18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("en");
    alepha.store.set(
      currentProjectAtom,
      projectFixture({ capabilities: ["reports"] }),
    );

    const view = render(
      <AlephaContext.Provider value={alepha}>
        <ProjectSettingsQualityPage />
      </AlephaContext.Provider>,
    );

    expect(await view.findByText(/Coverage target/)).toBeTruthy();
    expect(await view.findByText(/Coverage alert threshold/)).toBeTruthy();
    await alepha.stop();
  });
});
