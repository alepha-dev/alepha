import { I18n } from "@lore/core/web";
import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import ErrorTrustIcon from "./ErrorTrustIcon.tsx";

/**
 * An error group's trust state on the Errors page (#Q4242): an icon whose
 * label says who trusted it, or that a member must approve it, in place of
 * the text badge it replaces.
 */
describe("ErrorTrustIcon", () => {
  const mount = async (ui: ReactNode) => {
    const alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReact)
      .with(AlephaReactI18n)
      // The catalogue: without it `tr()` echoes the key.
      .with(I18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  it("shows a trusted group as a green check naming its member", async ({
    expect,
  }) => {
    const view = await mount(
      <ErrorTrustIcon trusted trustedByName="Ada Lovelace" />,
    );

    const icon = view.getByTestId("error-trusted");
    expect(icon.getAttribute("aria-label")).toBe("Trusted by Ada Lovelace");
    expect(icon.querySelector("svg")?.getAttribute("class")).toContain(
      "text-success",
    );
    expect(view.queryByText("Trusted")).toBeNull();
  });

  it("shows an untrusted group as an orange warning saying it needs approval", async ({
    expect,
  }) => {
    const view = await mount(<ErrorTrustIcon trusted={false} />);

    const icon = view.getByTestId("error-untrusted");
    expect(icon.getAttribute("aria-label")).toBe(
      "Source not trusted: a member must approve it before it is processed automatically",
    );
    expect(icon.querySelector("svg")?.getAttribute("class")).toContain(
      "text-warning",
    );
  });
});
