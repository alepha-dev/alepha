import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { FormValidationError, useForm } from "alepha/react/form";
import { $dictionary, AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, it } from "vitest";

import { uiFr } from "../../i18n/fr/uiFr.ts";
import { Control } from "../Control.tsx";

/**
 * A required field left empty is refused by the form's own schema, and the
 * person has to see that beside the field (error #585, #Q2343: the quest
 * form's title). The form sets `noValidate`, so the browser's own tooltip
 * never steps in: this inline message is the only one there is.
 *
 * Since #Q2343 that refusal is a `FormValidationError`, which is what keeps
 * the browser sigil from filing it as a crash. This pins that the subclass
 * still reaches the field the way a plain `SchemaValidationError` did.
 */
describe("Control and the schema's refusal of an empty required field", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const Probe = () => {
    const form = useForm({
      id: "required-title",
      schema: z.object({ title: z.text(), notes: z.text().optional() }),
      handler: () => {},
    });
    return (
      <form {...form.props} data-testid="form">
        <Control input={form.input.title} label="Title" />
        <Control input={form.input.notes} label="Notes" />
      </form>
    );
  };

  it("shows the refusal inline, on the required field only", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    const refusals: Error[] = [];
    alepha.events.on("react:action:error", (event) => {
      refusals.push(event.error);
    });
    const ui = mount(alepha, <Probe />);

    fireEvent.submit(ui.getByTestId("form"));

    const title = ui.getByLabelText(/Title/);
    await waitFor(() => {
      expect(title.getAttribute("aria-invalid")).toBe("true");
    });
    const describedBy = title.getAttribute("aria-describedby") ?? "";
    const message = describedBy
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    // An instruction, never the schema key (`'title' is required`).
    expect(message).toContain("This field is required");
    expect(message).not.toContain("'title'");
    expect(ui.getByLabelText(/Notes/).getAttribute("aria-invalid")).not.toBe(
      "true",
    );
    expect(refusals[0]).toBeInstanceOf(FormValidationError);

    await alepha.stop();
  });

  it("speaks the page's language", async ({ expect }) => {
    class Catalogues {
      en = $dictionary({ lazy: async () => ({ default: {} }) });
      fr = $dictionary({ lazy: async () => ({ default: uiFr }) });
    }
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    alepha.inject(Catalogues);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("fr");
    const ui = mount(alepha, <Probe />);

    fireEvent.submit(ui.getByTestId("form"));

    await waitFor(() => {
      expect(ui.getByText("Ce champ est obligatoire")).toBeTruthy();
    });

    await alepha.stop();
  });
});
