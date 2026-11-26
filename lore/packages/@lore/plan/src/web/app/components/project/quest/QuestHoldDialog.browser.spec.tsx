import { I18n } from "@lore/core/web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaDateTime } from "alepha/datetime";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { afterEach, describe, it } from "vitest";

import QuestHoldDialog from "./QuestHoldDialog.tsx";

/**
 * The hold dialog's day is the kit's `ControlDate`, not a native
 * `<input type="date">` (#Q4446): a day picked on its calendar, or by a quick
 * pick, is sent as the start of that day in the reader's time zone, and a day
 * that is not after today is refused inline.
 */
describe("QuestHoldDialog", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async () => {
    alepha = Alepha.create()
      .with(AlephaLogger)
      .with(AlephaDateTime)
      .with(AlephaReact)
      .with(AlephaReactI18n);
    alepha.inject(I18n);
    await alepha.start();

    const sent: Array<{ reason: string; until: string | undefined }> = [];
    render(
      <AlephaContext.Provider value={alepha}>
        <QuestHoldDialog
          open
          onOpenChange={() => {}}
          submitting={false}
          onConfirm={(reason, until) => sent.push({ reason, until })}
        />
      </AlephaContext.Provider>,
    );
    fireEvent.change(await screen.findByTestId("quest-hold-reason"), {
      target: { value: "Waiting on the vendor" },
    });
    return sent;
  };

  // The calendar is a lazy chunk: the first test to open it waits for it.
  const openCalendar = async () => {
    fireEvent.click(await screen.findByTestId("quest-hold-until"));
    await waitFor(
      () => {
        if (!document.querySelector('[role="gridcell"]')) {
          throw new Error("calendar not loaded yet");
        }
      },
      { timeout: 10_000 },
    );
  };

  const clickDay = async (label: string) => {
    const day = await waitFor(() => {
      const found = [
        ...document.querySelectorAll('[role="gridcell"] button'),
      ].find((button) => button.textContent === label);
      if (!found) throw new Error(`no day ${label}`);
      return found as HTMLElement;
    });
    fireEvent.click(day);
  };

  const submit = () => fireEvent.click(screen.getByTestId("quest-hold-submit"));

  it("renders the kit's date control, not a native date input", async ({
    expect,
  }) => {
    await mount();
    const trigger = await screen.findByTestId("quest-hold-until");
    expect(trigger.getAttribute("data-slot")).toBe("date-trigger");
    expect(document.querySelector('input[type="date"]')).toBe(null);
  });

  it("sends the start of a day picked on the calendar", async ({ expect }) => {
    const sent = await mount();
    await openCalendar();
    // Next month, so the day is always after today.
    const next = await waitFor(() => {
      const found = document.querySelector('button[aria-label*="next" i]');
      if (!found) throw new Error("no next month button");
      return found as HTMLElement;
    });
    fireEvent.click(next);
    await clickDay("15");

    await screen.findByRole("button", { name: "No date" });
    submit();

    expect(sent).toHaveLength(1);
    const now = new Date();
    const expected = new Date(now.getFullYear(), now.getMonth() + 1, 15);
    expect(sent[0]?.until).toBe(expected.toISOString());
  });

  it("refuses a day that is not after today", async ({ expect }) => {
    const sent = await mount();
    await openCalendar();
    // The 1st of this month is today at the latest.
    await clickDay("1");
    submit();

    expect(await screen.findByText("Pick a day after today.")).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it("sets the day from a quick pick and clears it with No date", async ({
    expect,
  }) => {
    const sent = await mount();
    fireEvent.click(await screen.findByRole("button", { name: "1 week" }));
    fireEvent.click(await screen.findByRole("button", { name: "No date" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "No date" })).toBe(null),
    );
    submit();
    expect(sent).toEqual([
      { reason: "Waiting on the vendor", until: undefined },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "2 weeks" }));
    await screen.findByRole("button", { name: "No date" });
    submit();
    const now = new Date();
    const expected = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 14,
    );
    expect(sent[1]?.until).toBe(expected.toISOString());
  });
});
