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
 * Multi-select used to render a bordered chips box instead of a trigger: a
 * different-looking control for the same job, one that grew with every pick
 * and then truncated, and one that forced a search field on because the chips
 * input was the only way to open the popup.
 *
 * It is the same button trigger as single-select now, labelled "value, then
 * count" — one selection names itself, two or more collapse. Nothing covered
 * any of this before, which is exactly how the chips box survived so long.
 */
describe("ControlSelect multi", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const STATUSES = [
    { value: "new", label: "New" },
    { value: "accepted", label: "In progress" },
    { value: "completed", label: "Completed" },
    { value: "shelved", label: "Shelved" },
  ];

  const LONG = Array.from({ length: 60 }, (_, i) => `opt-${i}`);

  const Probe = (props: {
    items?: (typeof STATUSES)[number][] | string[];
    countLabel?: (n: number) => string;
    createNewEntry?: boolean;
  }) => {
    const form = useForm({
      // An ARRAY field is the whole multi-select API — there is no `multi` prop.
      schema: z.object({ status: z.array(z.text()).optional() as never }),
      handler: () => {},
    });
    return (
      <>
        <ControlSelect
          input={form.input.status}
          label="Status"
          clearable
          clearLabel="All status"
          countLabel={props.countLabel}
          createNewEntry={props.createNewEntry}
          items={(props.items ?? STATUSES) as never}
        />
        <Reporter input={form.input.status} />
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

  const trigger = (ui: ReturnType<typeof render>) => ui.getByRole("combobox");
  const openPopup = (ui: ReturnType<typeof render>) =>
    fireEvent.keyDown(trigger(ui), { key: "ArrowDown" });

  it("renders one button trigger, not a chips box", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    // The chips box was a div with a nested text input; the trigger is a
    // button. Its absence is what proves the shape changed.
    expect(trigger(ui).tagName).toBe("BUTTON");
  });

  it("shows the placeholder while empty", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    expect(trigger(ui).textContent).toContain("All status");
  });

  it("omits the search field on a short list", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    await ui.findByRole("option", { name: /In progress/ });
    // Multi used to force this on unconditionally.
    expect(ui.queryByPlaceholderText("Search…")).toBeNull();
  });

  it("adds the search field above the threshold", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe items={LONG} />);

    openPopup(ui);
    await ui.findByRole("option", { name: "opt-0" });
    expect(ui.queryByPlaceholderText("Search…")).not.toBeNull();
  });

  it("adds the search field when entries can be created", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe createNewEntry />);

    openPopup(ui);
    await ui.findByRole("option", { name: /In progress/ });
    // Typing IS how a new entry is made, so a short list still gets one.
    expect(ui.queryByPlaceholderText("Search…")).not.toBeNull();
  });

  it("offers no clear row — a multi clears by deselecting", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    await ui.findByRole("option", { name: /In progress/ });
    expect(ui.queryByRole("option", { name: "All status" })).toBeNull();
  });

  it("names the value at one selection, and counts past that", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /In progress/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("accepted");
    });
    // One selection reads as the value — the commonest case, and the reason
    // a bare count everywhere would have been worse than chips.
    expect(trigger(ui).textContent).toContain("In progress");

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /Completed/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("accepted,completed");
    });
    expect(trigger(ui).textContent).toContain("2 selected");
    // The collapse is the point: the label must stop naming values so the
    // trigger keeps a fixed width.
    expect(trigger(ui).textContent).not.toContain("In progress");
  });

  it("honors a caller's countLabel", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe countLabel={(n) => `${n} status`} />);

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /In progress/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("accepted");
    });
    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /Completed/ }));

    await waitFor(() => {
      expect(trigger(ui).textContent).toContain("2 status");
    });
  });

  it("deselects a chosen row and falls back to the placeholder", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe />);

    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /In progress/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("accepted");
    });

    // Removing the last value was the chips' X button; with the chips gone,
    // pressing the selected row has to be the way back to empty.
    openPopup(ui);
    fireEvent.click(await ui.findByRole("option", { name: /In progress/ }));
    await waitFor(() => {
      expect(ui.getByTestId("value").textContent).toBe("∅");
    });
    expect(trigger(ui).textContent).toContain("All status");
  });
});
