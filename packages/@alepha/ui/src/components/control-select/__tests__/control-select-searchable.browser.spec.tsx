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
 * ControlSelect used to pick a *primitive* by option count: a native `Select`
 * below ~20 options, a `Combobox` above. That made per-option `description`,
 * `tag` and `disabled` — plus `triggerClassName` and deselection — appear or
 * vanish depending on how many siblings an option happened to have. Now a
 * single Combobox renders every list and the count only decides whether the
 * popup carries a search field.
 */
describe("ControlSelect searchable", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const SHORT = [
    { value: "user", label: "User", description: "Everyone", disabled: true },
    { value: "editor", label: "Editor", tag: "write" },
  ];

  const LONG = Array.from({ length: 30 }, (_, i) => `opt-${i}`);

  const Probe = (props: {
    searchable?: boolean;
    items?: (typeof SHORT)[number][] | string[];
  }) => {
    const form = useForm({
      schema: z.object({ role: z.text().optional() as never }),
      handler: () => {},
    });
    return (
      <>
        <ControlSelect
          input={form.input.role}
          label="Role"
          searchable={props.searchable}
          items={(props.items ?? SHORT) as never}
        />
        <Reporter input={form.input.role} />
      </>
    );
  };

  /**
   * Reads the bound value rather than the trigger label, which falls back to
   * the placeholder and would pass for the wrong reason.
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

  const searchInput = (ui: ReturnType<typeof render>) =>
    ui.queryByPlaceholderText("Search…");

  it("omits the search field on a short list", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    await ui.findByRole("option", { name: /Editor/ });
    expect(searchInput(ui)).toBeNull();
  });

  it("adds the search field above the threshold", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe items={LONG} />);

    openPopup(ui);
    await ui.findByRole("option", { name: "opt-0" });
    expect(searchInput(ui)).not.toBeNull();
  });

  it("honors an explicit `searchable` in both directions", async () => {
    const alepha = await start();

    const forcedOn = mount(alepha, <Probe searchable />);
    openPopup(forcedOn);
    await forcedOn.findByRole("option", { name: /Editor/ });
    expect(forcedOn.queryByPlaceholderText("Search…")).not.toBeNull();
    forcedOn.unmount();

    const forcedOff = mount(alepha, <Probe searchable={false} items={LONG} />);
    openPopup(forcedOff);
    await forcedOff.findByRole("option", { name: "opt-0" });
    expect(forcedOff.queryByPlaceholderText("Search…")).toBeNull();
  });

  it("still renders description and tag on a short list", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    // Both were silently dropped by the native-`Select` path.
    expect(await ui.findByText("Everyone")).toBeTruthy();
    expect(await ui.findByText("write")).toBeTruthy();
  });

  it("selects without a search field, and refuses a disabled row", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /Editor/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("editor");
    });

    // Pressed second, so "still editor" proves the row is inert rather than
    // matching the state the field started in. `disabled` reached the row only
    // on the combobox path, so a mandatory option used to be selectable as
    // soon as its list was short enough.
    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /User/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("editor");
    });
  });
});
