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
import { AutoForm } from "../AutoForm.tsx";

void Calendar;

/**
 * `autoSave` submits a field that commits a discrete value, and skips only
 * the free-text ones (they commit on Enter or the inline tick). A date is a
 * string schema, but it is picked in a calendar that has neither, and the
 * bottom bar is hidden in this mode: skipping it meant a date edit was never
 * saved at all.
 */
describe("AutoForm autoSave", () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  let submits = 0;

  const Probe = () => {
    const form = useForm({
      schema: z.object({
        due: z.date().optional(),
        on: z.boolean().optional(),
      }),
      handler: () => {
        submits += 1;
      },
    });
    return (
      <AutoForm
        form={form}
        autoSave={{ delay: 10 }}
        fields={{ due: { label: "Due" }, on: { label: "On" } }}
      />
    );
  };

  const mount = async () => {
    submits = 0;
    const alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <Probe />
      </AlephaContext.Provider>,
    );
  };

  it("submits once a boolean changes", async () => {
    const ui = await mount();
    fireEvent.click(ui.getByRole("switch"));
    await waitFor(() => expect(submits).toBe(1));
  });

  it("submits once a date is picked", async () => {
    await mount();
    const trigger = await waitFor(() => {
      const found = document.querySelector('[data-slot="date-trigger"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(trigger);
    const day = await waitFor(() => {
      const found = document.querySelector('[role="gridcell"] button');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(day);

    await waitFor(() => expect(submits).toBe(1));
  });
});
