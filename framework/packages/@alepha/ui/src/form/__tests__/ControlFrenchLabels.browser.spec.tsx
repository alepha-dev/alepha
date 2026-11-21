import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { $dictionary, AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { AlephaServerLinks } from "alepha/server/links";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { uiFr } from "../../i18n/fr/uiFr.ts";
import { Control } from "../Control.tsx";
import { FormFieldAutoSaveProvider } from "../FormFieldAutoSaveProvider.tsx";

/**
 * The form controls' own words go through the catalogue: on a French page,
 * the tick and the cross of a text field, a select's search field, the
 * password toggle and an upload's preview read French, not English.
 */
describe("form controls on a French page", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  class Catalogues {
    en = $dictionary({ lazy: async () => ({ default: {} }) });
    // The real catalogue, so a key renamed on one side only goes red here.
    fr = $dictionary({ lazy: async () => ({ default: uiFr }) });
  }

  const mount = async (ui: ReactNode) => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaReactI18n)
      // The upload control's client.
      .with(AlephaServerLinks);
    alepha.inject(Catalogues);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang("fr");
    return render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );
  };

  const Text = (props: { autoSave?: boolean }) => {
    const form = useForm({
      schema: z.object({ name: z.text().optional() }),
      initialValues: { name: "Ada" },
      handler: () => {},
    });
    return (
      <FormFieldAutoSaveProvider value={!!props.autoSave}>
        <Control input={form.input.name} label="Nom" />
      </FormFieldAutoSaveProvider>
    );
  };

  it("names the clear cross of a text field", async () => {
    const ui = await mount(<Text />);
    expect(ui.getByRole("button", { name: "Effacer" })).toBeTruthy();
  });

  it("names the save tick of an auto-saved text field", async () => {
    const ui = await mount(<Text autoSave />);
    fireEvent.change(ui.getByLabelText(/Nom/), { target: { value: "Grace" } });
    await waitFor(() =>
      expect(ui.getByRole("button", { name: "Enregistrer" })).toBeTruthy(),
    );
  });

  it("shows the search placeholder of a searchable select", async () => {
    const Select = () => {
      const form = useForm({
        schema: z.object({ tag: z.text().optional() }),
        handler: () => {},
      });
      return (
        <Control input={form.input.tag} combobox items={["docs", "react"]} />
      );
    };
    const ui = await mount(<Select />);
    fireEvent.keyDown(ui.getByRole("combobox"), { key: "ArrowDown" });
    await waitFor(() =>
      expect(ui.getByPlaceholderText("Rechercher…")).toBeTruthy(),
    );
  });

  it("names the password toggle", async () => {
    const Password = () => {
      const form = useForm({
        schema: z.object({ secret: z.text().meta({ format: "password" }) }),
        handler: () => {},
      });
      return <Control input={form.input.secret} label="Secret" />;
    };
    const ui = await mount(<Password />);
    const toggle = ui.getByRole("button", {
      name: "Afficher le mot de passe",
    });
    fireEvent.click(toggle);
    expect(
      ui.getByRole("button", { name: "Masquer le mot de passe" }),
    ).toBeTruthy();
  });

  it("describes a stored file of unknown type", async () => {
    const Upload = () => {
      const form = useForm({
        schema: z.object({ file: z.uuid().optional() }),
        initialValues: { file: "00000000-0000-4000-8000-000000000000" },
        handler: () => {},
      });
      return <Control input={form.input.file} label="Fichier" upload />;
    };
    const ui = await mount(<Upload />);
    fireEvent.click(
      ui
        .getAllByRole("button")
        .find((b) => b.tabIndex === 0 && b.tagName === "DIV")!,
    );
    await waitFor(() => expect(ui.getByRole("dialog")).toBeTruthy());
    const dialog = ui.getByRole("dialog");
    const describedBy = dialog.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe("envoyé");
  });
});
