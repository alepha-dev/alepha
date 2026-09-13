import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import { beforeAll, describe, expect, it } from "vitest";

import { Control } from "../control.tsx";

/**
 * `z.dateRange()` renders as a range picker, and never as anything else.
 *
 * The trap this file mostly exists for is the dispatch ORDER: a range IS an
 * array, so `control.tsx`'s `meta.isArray` branch matches it and renders a
 * multi-select combobox - which looks like a deliberate control and is
 * silently the wrong one.
 */
describe("Control (date range)", () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  const start = async () => {
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return alepha;
  };

  /**
   * The last value the field was written with, so a case can assert what the
   * control SENT and not only what it drew. `undefined` until something is.
   */
  let written: unknown;

  const Probe = (props: { initial?: string[] }) => {
    const form = useForm({
      schema: z.object({ createdAt: z.dateRange().optional() }),
      initialValues: props.initial ? { createdAt: props.initial } : undefined,
      handler: () => {},
      onChange: (_key, value) => {
        written = value;
      },
    });
    return <Control input={form.input.createdAt} clearable />;
  };

  const mount = async (initial?: string[]) => {
    written = undefined;
    const alepha = await start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <Probe initial={initial} />
      </AlephaContext.Provider>,
    );
  };

  const trigger = () =>
    document.querySelector('[data-slot="date-trigger"]') as HTMLElement;

  /**
   * The clear `x`, found the way the kit arranges it: the trigger's adjacent
   * sibling, inside the `relative` wrapper that positions it ON the trigger.
   *
   * ⚠️ Named by SHAPE rather than by its accessible name, because the name is
   * shared with every select on the page (`controlSelect.clear`), and a filter
   * bar routinely has three. That sharing is the point - feedback #2197 was
   * that this control looked and behaved like a different kit - so the locator
   * is the thing that had to become specific.
   */
  const clearButton = () =>
    document.querySelector(
      '[data-slot="date-trigger"] + [data-slot="control-clear"]',
    ) as HTMLElement | null;

  it("renders the range trigger, not a combobox", async () => {
    const { container } = await mount();

    await waitFor(() => expect(trigger()).not.toBeNull());
    // ⚠️ The regression this file is named for. `ControlSelect` renders a
    // `combobox`; if the array branch ever moves back above the range one,
    // this is what goes red.
    expect(container.querySelector('[role="combobox"]')).toBeNull();
  });

  it("shows both ends of a stored range", async () => {
    await mount(["2026-01-01", "2026-01-31"]);

    await waitFor(() => {
      // Rendered through `toLocaleDateString`, so this asserts the shape
      // rather than a locale's punctuation: two dates, one separator.
      expect(trigger().textContent).toContain("-");
    });
    // ⚠️ Parsed in LOCAL parts. `new Date("2026-01-01")` is UTC midnight,
    // which renders as December 31st west of Greenwich - so a control that
    // parsed it as an instant would show the wrong day for half the world.
    expect(trigger().textContent).toContain("2026");
    expect(trigger().textContent).not.toContain("2025");
  });

  it("shows its placeholder while empty, and offers no clear", async () => {
    await mount();

    await waitFor(() =>
      expect(trigger().textContent).toContain("Pick a date range"),
    );
    // A calendar has no "none" cell, so `clearable` is the only way back to
    // empty - and there is nothing to clear before something is picked.
    expect(clearButton()).toBeNull();
  });

  it("clears back to no filter, with the kit's own x", async () => {
    await mount(["2026-01-01", "2026-01-31"]);

    const clear = await waitFor(() => {
      const found = clearButton();
      expect(found).not.toBeNull();
      return found!;
    });
    // The same accessible name every clearable control in the kit carries,
    // translated. It used to be a hardcoded English "Clear date range", on a
    // ghost icon BUTTON sitting outside the trigger.
    expect(clear.getAttribute("aria-label")).toBe("Clear selection");
    fireEvent.click(clear);

    await waitFor(() => expect(written).toBeUndefined());
    expect(trigger().textContent).toContain("Pick a date range");
  });

  /**
   * ⚠️ **The gesture, driven through two real clicks**, which is what found
   * the bug this guards.
   *
   * The trap the design anticipated was DayPicker answering `{ from }` with
   * no `to` mid-gesture. react-day-picker ^10 does something else, and it is
   * worse for a naive control: the FIRST click answers `{ from: d, to: d }`,
   * a complete one-day range. A control writing whenever both ends existed
   * would take the start date as the whole range and shut the popover before
   * the reader picked an end. Nothing short of two clicks shows that.
   */
  describe("the two-click gesture", () => {
    /**
     * ⚠️ The day BUTTON, not the cell. react-day-picker renders a `gridcell`
     * wrapping a button, and only the button carries the handler - a click on
     * the cell reaches nothing and the case passes for the wrong reason.
     */
    const days = async () =>
      await waitFor(() => {
        const found = [
          ...document.querySelectorAll('[role="gridcell"] button'),
        ] as HTMLElement[];
        expect(found.length).toBeGreaterThan(1);
        return found;
      });

    it("writes nothing on the first click, and keeps the popover open", async () => {
      await mount();
      await waitFor(() => expect(trigger()).not.toBeNull());
      fireEvent.click(trigger());

      fireEvent.click((await days())[0]!);

      // The trigger shows the day, so the click is not lost...
      await waitFor(() =>
        expect(trigger().textContent).not.toContain("Pick a date range"),
      );
      // ...and the field has not taken it.
      expect(written).toBeUndefined();
      // The calendar is still there to pick the other end on.
      expect(document.querySelector('[role="gridcell"] button')).not.toBeNull();
    });

    it("writes both ends on the second click", async () => {
      await mount();
      await waitFor(() => expect(trigger()).not.toBeNull());
      fireEvent.click(trigger());

      fireEvent.click((await days())[5]!);
      // ⚠️ Re-queried, never reused. The first click re-renders the calendar,
      // so every button captured before it is a detached node and clicking
      // one does nothing at all - which reads exactly like the control
      // ignoring the second click.
      fireEvent.click((await days())[12]!);

      await waitFor(() => expect(Array.isArray(written)).toBe(true));
      const value = written as string[];
      expect(value).toHaveLength(2);
      // Two date-only strings, in order, and never an instant.
      expect(value[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(value[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(value[1]! >= value[0]!).toBe(true);
      // Which is what `z.dateRange()` accepts, checked rather than assumed.
      expect(z.dateRange().safeParse(value).success).toBe(true);
    });
  });
});
