import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { ControlSelect } from "../control-select.tsx";

/**
 * Where a `clearable` field's label belongs: on the trigger, and nowhere else.
 *
 * ⚠️ This file used to assert the OPPOSITE of what it asserts now, and the
 * reversal is deliberate rather than drift.
 *
 * It was written when `ControlSelect` injected a synthetic clear ROW at the
 * top of a single-select's list, and when two render paths disagreed about
 * whether that row was a genuine selected value (full contrast) or a
 * placeholder (muted) - so the same filter changed colour the day its option
 * list crossed a threshold. Its cases therefore pinned "reads as a value, not
 * a placeholder" on both paths.
 *
 * Two things have since changed. The paths converged - the threshold now only
 * decides whether a search input appears, never which control you get - and
 * the clear row is gone: it said the same thing the trigger already says, a
 * second time, as a pickable option with a check mark, so "All states" read
 * as a third state rather than as the absence of a filter (feedback #2092,
 * then #2098).
 *
 * So empty is now EMPTY: `clearLabel` is the trigger's placeholder, styled as
 * one, and getting back there is either the `x` the trigger grows once
 * something is chosen or re-clicking the chosen row
 * (`control-select-deselect.browser.spec.tsx`).
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

  const clearButton = (ui: ReturnType<typeof render>) =>
    ui.queryByRole("button", { name: "Clear selection" });

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

  it("shows the clear label on the trigger, as a placeholder", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe count={5} clearable />);

    expect(trigger(ui).textContent).toContain("All tags");
    // The reversal: empty is empty, so it is styled as the placeholder it is.
    expect(readsAsPlaceholder(trigger(ui))).toBe(true);
  });

  it("does the same past the search threshold", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe count={25} clearable />);

    // The threshold decides whether you can type, never which control you
    // get, so the two option counts cannot disagree about this any more.
    expect(trigger(ui).textContent).toContain("All tags");
    expect(readsAsPlaceholder(trigger(ui))).toBe(true);
  });

  it("reads as a placeholder without a clear label too", async () => {
    const alepha = await start();

    const short = mount(alepha, <Probe count={5} />);
    expect(readsAsPlaceholder(trigger(short))).toBe(true);
    short.unmount();

    const long = mount(alepha, <Probe count={25} />);
    expect(readsAsPlaceholder(trigger(long))).toBe(true);
  });

  /**
   * The change itself: the label appears ONCE. Before this, opening a
   * `clearable` single-select showed "All tags" again as the first row.
   */
  it("puts no clear row in the list", async () => {
    const alepha = await start();
    const ui = mount(alepha, <Probe count={5} clearable />);

    trigger(ui).click();

    const rows = await ui.findAllByRole("option");
    const labels = rows.map((r) => r.textContent);
    expect(labels).not.toContain("All tags");
    // The real options are all still there.
    expect(labels).toContain("tag-0");
    expect(labels).toHaveLength(5);
  });

  /**
   * The affordance that replaced the row, in the place the row was never in.
   *
   * Deleting the row left re-pressing the chosen option as the only way back
   * to empty, which works but is quiet - the row was the visible half. This
   * is the answer the quest named ahead of time: an `x` on the trigger, not
   * the row coming back.
   */
  describe("the clear button", () => {
    it("appears only once something is chosen", async () => {
      const alepha = await start();
      const ui = mount(alepha, <Probe count={5} clearable />);

      // Nothing selected: the trigger already says "All tags", so an `x`
      // beside it would offer to reach the state it is in.
      expect(clearButton(ui)).toBeNull();

      trigger(ui).click();
      fireEvent.click(await ui.findByRole("option", { name: "tag-2" }));

      await waitFor(() => expect(clearButton(ui)).not.toBeNull());
    });

    it("puts the field back to its clear label", async () => {
      const alepha = await start();
      const ui = mount(alepha, <Probe count={5} clearable />);

      trigger(ui).click();
      fireEvent.click(await ui.findByRole("option", { name: "tag-2" }));
      await waitFor(() => expect(trigger(ui).textContent).toContain("tag-2"));

      fireEvent.click(clearButton(ui)!);

      await waitFor(() => {
        expect(trigger(ui).textContent).toContain("All tags");
      });
      // Reads as a placeholder again, not as a value called "All tags".
      expect(readsAsPlaceholder(trigger(ui))).toBe(true);
      expect(clearButton(ui)).toBeNull();
    });

    it("stays off a field that never asked for one", async () => {
      const alepha = await start();
      // Not `clearable`: an ordinary optional field keeps the trigger it
      // has, and clears by re-pressing its row like it always could.
      const ui = mount(alepha, <Probe count={5} />);

      trigger(ui).click();
      fireEvent.click(await ui.findByRole("option", { name: "tag-2" }));
      await waitFor(() => expect(trigger(ui).textContent).toContain("tag-2"));

      expect(clearButton(ui)).toBeNull();
    });
  });
});
