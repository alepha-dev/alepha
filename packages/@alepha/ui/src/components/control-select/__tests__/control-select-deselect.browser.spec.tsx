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
 * Base UI's single-select `Combobox` re-selects on every item press - it never
 * emits `null` - so a searchable select had no way back to the empty state once
 * a value was picked. The native-`Select` render path could, through the clear
 * ROW it injected, which made the gap invisible until a field crossed the
 * option count that switches it to the combobox.
 *
 * ⚠️ That row is gone (feedback #2098), so pressing the selected item again
 * is no longer one of two ways back to empty - it is the only one, on both
 * paths. These cases are what that now rests on.
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

  /**
   * ⚠️ This case used to click an "All zones" ROW to get back to empty, and
   * the reversal is deliberate rather than drift.
   *
   * `clearLabel` names the empty state, and the empty state is what the
   * trigger already shows when nothing is picked. Repeating it as a pickable
   * option with a check mark made "All zones" read as a third zone rather
   * than as the absence of a filter, so the list is now the options and
   * nothing else. The way back is the same gesture on both render paths:
   * press the chosen row again.
   */
  it("goes back to 'All …' by re-pressing, with no clear row to press", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe clearable clearLabel="All zones" />);

    openPopup(ui);
    const rows = await ui.findAllByRole("option");
    expect(rows.map((r) => r.textContent)).toEqual(["docs", "react"]);

    fireEvent.click(await ui.findByRole("option", { name: "docs" }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("docs");
    });

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: "docs" }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("∅");
    });
    // And the label it goes back to is on the trigger, which is the one
    // place it appears now.
    expect(ui.getByRole("combobox").textContent).toContain("All zones");
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
