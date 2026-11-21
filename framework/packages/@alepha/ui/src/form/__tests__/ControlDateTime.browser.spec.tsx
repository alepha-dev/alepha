import { fireEvent, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { AlephaReactI18n } from "alepha/react/i18n";
import { beforeAll, describe, expect, it } from "vitest";

// The calendar is a lazy chunk: imported with the file so the first popover
// does not wait on a cold import (see `ControlDateRange.browser.spec.tsx`).
import { Calendar } from "../../calendar/Calendar.tsx";
import { Control } from "../Control.tsx";

void Calendar;

/**
 * A date-time field keeps its time when another day is picked: the calendar
 * hands back the day at local midnight, and writing that as is reset the
 * time the person had set.
 */
describe("Control (date-time)", () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  let written: unknown;

  const Probe = (props: { initial: string }) => {
    const form = useForm({
      schema: z.object({ at: z.datetime().optional() }),
      initialValues: { at: props.initial },
      handler: () => {},
      onChange: (_key, value) => {
        written = value;
      },
    });
    return <Control input={form.input.at} />;
  };

  it("keeps the hours and minutes when another day is picked", async () => {
    written = undefined;
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    // Local time, in this month, so the calendar opens on it whatever the
    // runtime's time zone.
    const now = new Date();
    const initial = new Date(now.getFullYear(), now.getMonth(), 10, 14, 30);
    render(
      <AlephaContext.Provider value={alepha}>
        <Probe initial={initial.toISOString()} />
      </AlephaContext.Provider>,
    );

    const trigger = await waitFor(() => {
      const found = document.querySelector('[data-slot="date-trigger"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(trigger);
    const day = await waitFor(() => {
      const found = [
        ...document.querySelectorAll('[role="gridcell"] button'),
      ].find((button) => button.textContent === "16");
      expect(found).toBeDefined();
      return found as HTMLElement;
    });
    fireEvent.click(day);

    await waitFor(() => expect(typeof written).toBe("string"));
    const picked = new Date(written as string);
    expect(picked.getDate()).toBe(16);
    expect(picked.getMonth()).toBe(initial.getMonth());
    expect(picked.getHours()).toBe(14);
    expect(picked.getMinutes()).toBe(30);

    await alepha.stop();
  });
});
