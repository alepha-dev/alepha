import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { type BaseInputField, useFieldValue, useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import { describe, expect, it } from "vitest";

import { Control } from "../Control.tsx";

/**
 * An open-ended list of strings, a username blocklist, says so on its schema
 * (#Q3424): `.meta({ $control: { createNewEntry: true } })`. A generated form
 * (`AutoForm`, Admin > Parameters) then renders a multi-select whose existing
 * values are rows and where typing adds one. Without the hint it offered the
 * current values only, and nothing could be added.
 */
describe("Control on a string array marked createNewEntry", () => {
  const Form = () => {
    const form = useForm({
      schema: z.object({
        blocklist: z
          .array(z.text())
          .meta({ $control: { createNewEntry: true } }),
      }),
      initialValues: { blocklist: ["admin", "root"] },
      handler: () => {},
    });
    return (
      <>
        <Control input={form.input.blocklist} label="Blocklist" />
        <Reporter input={form.input.blocklist} />
      </>
    );
  };

  const Reporter = (props: { input: BaseInputField }) => {
    const [value] = useFieldValue(props.input);
    return (
      <span data-testid="value">
        {Array.isArray(value) && value.length ? value.join(",") : "∅"}
      </span>
    );
  };

  const mount = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <Form />
      </AlephaContext.Provider>,
    );
  };

  const trigger = (ui: ReturnType<typeof render>) =>
    ui.getAllByRole("combobox").find((el) => el.tagName === "BUTTON")!;
  const openPopup = (ui: ReturnType<typeof render>) =>
    fireEvent.keyDown(trigger(ui), { key: "ArrowDown" });

  it("adds a typed value", async () => {
    const ui = await mount();

    openPopup(ui);
    fireEvent.change(ui.getByPlaceholderText("Search…"), {
      target: { value: "support" },
    });
    fireEvent.click(await ui.findByRole("option", { name: /support/ }));

    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("admin,root,support");
    });
  });

  it("removes an existing value, which is a row although no option names it", async () => {
    const ui = await mount();

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: "root" }));

    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("admin");
    });
  });
});
