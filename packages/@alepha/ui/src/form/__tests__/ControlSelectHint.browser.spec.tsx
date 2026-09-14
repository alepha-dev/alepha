import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { type BaseInputField, useFieldValue, useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ControlSelect } from "../ControlSelect.tsx";

/**
 * An option's `hint`: muted text ahead of its label.
 *
 * It exists for a list whose values need their context read first, which
 * Lore's blights inbox had in "ui/production", "docs/production": the
 * environment is the label and "ui/" the hint, muted so the environment is
 * what the eye lands on. The label alone cannot tell two apps' production
 * apart, which is why the hint precedes it on the trigger too and why a query
 * matches it.
 */
describe("ControlSelect hint", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const APPS = [
    { value: "s1", label: "production", hint: "ui/" },
    { value: "s2", label: "production", hint: "docs/" },
    { value: "s3", label: "staging", hint: "docs/" },
  ];

  const Probe = () => {
    const form = useForm({
      schema: z.object({ app: z.text().optional() as never }),
      handler: () => {},
    });
    return (
      <>
        <ControlSelect
          input={form.input.app}
          label="App"
          clearable
          clearLabel="All apps"
          searchable
          items={APPS}
        />
        <Reporter input={form.input.app} />
      </>
    );
  };

  const Reporter = (props: { input: BaseInputField }) => {
    const [value] = useFieldValue(props.input);
    return <span data-testid="value">{String(value ?? "∅")}</span>;
  };

  /**
   * The BUTTON: the popup's search field carries `role="combobox"` too.
   */
  const trigger = (ui: ReturnType<typeof render>) =>
    ui.getAllByRole("combobox").find((el) => el.tagName === "BUTTON")!;

  const openPopup = (ui: ReturnType<typeof render>) =>
    fireEvent.keyDown(trigger(ui), { key: "ArrowDown" });

  it("draws the hint on its row, ahead of the label", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    const rows = await waitFor(() => {
      const found = ui.getAllByRole("option");
      expect(found).toHaveLength(3);
      return found;
    });
    expect(rows[2]!.textContent).toBe("docs/staging");
    const hint = [...rows[2]!.querySelectorAll("span")].find(
      (el) => el.textContent === "docs/",
    );
    expect(hint?.className).toContain("text-muted-foreground");
    // In the label's own text run, with no gap: the separator is the hint's.
    expect(hint?.parentElement?.textContent).toBe("docs/staging");
  });

  it("matches a typed query against the hint", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    fireEvent.change(await ui.findByPlaceholderText("Search…"), {
      target: { value: "ui" },
    });

    // No label contains "ui": only the hint can have matched.
    await waitFor(() => {
      expect(ui.getAllByRole("option")).toHaveLength(1);
    });
    expect(ui.getByRole("option").textContent).toBe("ui/production");
  });

  it("puts the hint ahead of the label on the trigger", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    const rows = await waitFor(() => {
      const found = ui.getAllByRole("option");
      expect(found).toHaveLength(3);
      return found;
    });
    fireEvent.click(rows[2]!);

    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("s3");
    });
    // "staging" alone would not say which app's was picked.
    expect(trigger(ui).textContent).toContain("docs/staging");
  });
});
