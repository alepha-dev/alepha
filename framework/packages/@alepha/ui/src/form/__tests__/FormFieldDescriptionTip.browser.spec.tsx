import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { FormField } from "../FormField.tsx";
import { FORM_FIELD_DESCRIPTION_INLINE_MAX } from "../FormFieldDescriptionTip.tsx";

/**
 * A description past the threshold moves behind an (i) on the label line,
 * shown on hover or focus (#Q3427). A short one stays under the field.
 */
describe("FormField description", () => {
  const mount = async (ui: ReactNode) => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  const LONG = "Maximum time a refresh token may stay unused. ".repeat(4);

  it("keeps a short description inline, with no icon", async () => {
    const ui = await mount(
      <FormField id="f" label="Name" description="Shown on your profile">
        <input id="f" aria-describedby="f-description" />
      </FormField>,
    );

    expect(ui.getByText("Shown on your profile").className).toContain(
      "text-muted-foreground",
    );
    expect(ui.queryByRole("button", { name: "About this field" })).toBeNull();
  });

  it("moves a long one behind a focusable (i) whose tooltip shows it", async () => {
    expect(LONG.length).toBeGreaterThan(FORM_FIELD_DESCRIPTION_INLINE_MAX);
    const ui = await mount(
      <FormField id="f" label="Expiration idle" description={LONG}>
        <input id="f" />
      </FormField>,
    );

    const tip = ui.getByRole("button", { name: "About this field" });
    // Still in the DOM for the field's aria-describedby, but not on screen.
    expect(ui.getAllByText(LONG.trim(), { exact: false })[0]!.className).toBe(
      "sr-only",
    );

    tip.focus();
    fireEvent.focus(tip);
    await waitFor(() => {
      expect(
        ui.getAllByText(LONG.trim(), { exact: false }).length,
      ).toBeGreaterThan(1);
    });
  });
});
