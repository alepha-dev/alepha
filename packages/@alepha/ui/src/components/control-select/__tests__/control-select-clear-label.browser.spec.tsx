import { render } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ControlSelect } from "../control-select.tsx";

/**
 * `ControlSelect` picks between a native `Select` and a `Combobox` on option
 * count (>20 → combobox). The two paths disagreed about what the `clearable`
 * row's label *is*: the Select path made it a genuine selected value, the
 * combobox passed it through as a placeholder and muted the trigger. So the
 * same filter, meaning the same thing, changed colour the day its option list
 * grew past 20 — which is exactly what happened to the quests board, where
 * "All status" and "All areas" read as set and "All tags" read as unset.
 *
 * These assert on the render path rather than the colour of one of them: what
 * matters is that the two agree, so a future change to either has to move both.
 */
describe("ControlSelect clear label", () => {
  const mount = (alepha: Alepha, ui: ReactNode) =>
    render(
      <AlephaContext.Provider value={alepha}>{ui}</AlephaContext.Provider>,
    );

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  const items = (count: number) =>
    Array.from({ length: count }, (_, i) => `tag-${i}`);

  const Probe = (props: { count: number; clearable?: boolean }) => {
    const form = useForm({
      schema: z.object({ tag: z.text().optional() as never }),
      handler: () => {},
    });
    return (
      <ControlSelect
        input={form.input.tag}
        label="Tag"
        clearable={props.clearable}
        clearLabel="All tags"
        items={items(props.count)}
      />
    );
  };

  /**
   * Both paths render their trigger as the field's only `combobox` role — the
   * shadcn `SelectTrigger` and the Base UI `ComboboxTrigger` alike — so one
   * query reaches whichever one the option count selected.
   */
  const trigger = (ui: ReturnType<typeof render>) =>
    ui.getByRole("combobox") as HTMLElement;

  /**
   * "Reads as greyed", asked in the one way that covers both paths. The two
   * arrive there by different mechanisms and no stylesheet runs under jsdom to
   * flatten them: the combobox trigger takes `text-muted-foreground` outright,
   * while `SelectTrigger` always carries the conditional
   * `data-placeholder:text-muted-foreground` and only greys once Base UI
   * stamps `data-placeholder` on it — which it does exactly when `SelectValue`
   * falls back to its placeholder instead of rendering a chosen value.
   */
  const readsAsPlaceholder = (el: HTMLElement) =>
    el.hasAttribute("data-placeholder") ||
    el.className.split(/\s+/).includes("text-muted-foreground");

  it("renders the clear label as a value on the Select path", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe count={5} clearable />);

    expect(trigger(ui).textContent).toContain("All tags");
    expect(readsAsPlaceholder(trigger(ui))).toBe(false);
  });

  it("renders the clear label the same way past the 20-option threshold", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe count={25} clearable />);

    expect(trigger(ui).textContent).toContain("All tags");
    expect(readsAsPlaceholder(trigger(ui))).toBe(false);
  });

  it("still reads as a placeholder when there is no clear row", async () => {
    const alepha = await start();

    const short = mount(alepha, <Probe count={5} />);
    expect(readsAsPlaceholder(trigger(short))).toBe(true);
    short.unmount();

    const long = mount(alepha, <Probe count={25} />);
    expect(readsAsPlaceholder(trigger(long))).toBe(true);
  });
});
