import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { type BaseInputField, useFieldValue, useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ControlSelect } from "../control-select.tsx";

/**
 * Base UI's single-select `Combobox` re-selects on every item press — it never
 * emits `null` — so a searchable select had no way back to the empty state once
 * a value was picked. The native-`Select` render path has always been able to
 * (its `clearable` row), which made the gap invisible until a field crossed the
 * option count that switches it to the combobox.
 */
describe("ControlSelect combobox deselection", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const Probe = (props: {
    required?: boolean;
    clearable?: boolean;
    clearLabel?: string;
  }) => {
    const form = useForm({
      schema: z.object(
        props.required
          ? { tag: z.text() }
          : { tag: z.text().optional() as never },
      ),
      handler: () => {},
    });
    return (
      <>
        <ControlSelect
          input={form.input.tag}
          label="Tag"
          combobox
          clearable={props.clearable}
          clearLabel={props.clearLabel}
          items={["docs", "react"]}
        />
        <Reporter input={form.input.tag} />
      </>
    );
  };

  /**
   * Renders the bound value so the assertions read the form state rather than
   * the trigger's label, which falls back to the placeholder and would pass for
   * the wrong reason.
   */
  const Reporter = (props: { input: BaseInputField }) => {
    const [value] = useFieldValue(props.input);
    return (
      <span data-testid="value">
        {value === undefined ? "∅" : String(value)}
      </span>
    );
  };

  const openPopup = (ui: ReturnType<typeof render>) => {
    fireEvent.keyDown(ui.getByRole("combobox"), { key: "ArrowDown" });
  };

  it("offers the clearable row so a filter can go back to 'All …'", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe clearable clearLabel="All zones" />);

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: "docs" }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("docs");
    });

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: "All zones" }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("∅");
    });
  });

  it("clears an optional field when the selected row is pressed again", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: "docs" }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("docs");
    });

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: "docs" }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("∅");
    });
  });

  it("keeps the value on a required field", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe required />);

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: "docs" }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("docs");
    });

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: "docs" }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("docs");
    });
  });
});
