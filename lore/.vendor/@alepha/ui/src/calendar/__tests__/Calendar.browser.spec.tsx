import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/testing/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Calendar } from "../Calendar.tsx";

/**
 * The calendar follows the app's language: month and weekday names come from
 * the date-fns locale matching `useI18n().lang`.
 *
 * ⚠️ This regresses silently (#F60). A stock react-day-picker calendar
 * compiles, renders, and speaks English whatever the app does, so nothing but
 * a spec that reads the names can tell. `Calendar` renders inline with no
 * popup, which is what lets jsdom see it.
 */
describe("Calendar language", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const mount = async (lang: string) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang(lang);
    return render(
      <AlephaContext.Provider value={alepha}>
        {/* A fixed month, so the names asserted never move with the clock. */}
        <Calendar mode="single" defaultMonth={new Date(2026, 0, 15)} />
      </AlephaContext.Provider>,
    );
  };

  const caption = (container: HTMLElement) =>
    container.querySelector(".rdp-caption_label")?.textContent ?? "";

  const weekdays = (container: HTMLElement) =>
    [...container.querySelectorAll(".rdp-weekday")].map((it) =>
      (it.getAttribute("aria-label") ?? "").toLowerCase(),
    );

  it("names the month and the weekdays in French", async () => {
    const { container } = await mount("fr");

    expect(caption(container).toLowerCase()).toContain("janvier");
    expect(weekdays(container)).toContain("lundi");
    expect(weekdays(container)).not.toContain("monday");
  });

  it("names the month and the weekdays in English", async () => {
    const { container } = await mount("en");

    expect(caption(container)).toContain("January");
    expect(weekdays(container)).toContain("monday");
    expect(weekdays(container)).not.toContain("lundi");
  });
});

/**
 * Today is marked by a bar under its number, never by a fill: the fill it had
 * was the one a range endpoint draws, so beside a picked range today read as
 * a third selection (feedback #P2203, #Q2334).
 */
describe("Calendar today", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    setupJsdomMocks();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  const today = new Date(2026, 8, 12);

  const mount = async (selected?: { from: Date; to: Date }) => {
    alepha = Alepha.create().with(AlephaReactI18n);
    await alepha.start();
    return render(
      <AlephaContext.Provider value={alepha}>
        <Calendar
          mode="range"
          today={today}
          defaultMonth={today}
          selected={selected}
        />
      </AlephaContext.Provider>,
    );
  };

  /**
   * The cell and the button of the day named `day` of the shown month.
   */
  const dayOf = (container: HTMLElement, day: number) => {
    const button = [
      ...container.querySelectorAll<HTMLButtonElement>("td button"),
    ].find(
      (it) =>
        it.textContent === String(day) &&
        !it.closest("td")?.className.includes("rdp-outside"),
    );
    return { button, cell: button?.closest("td") };
  };

  const fills = (className: string | undefined) =>
    (className ?? "").split(/\s+/).filter((it) => it.startsWith("bg-"));

  it("draws no fill on today's cell or button, and marks it for the bar", async () => {
    const { container } = await mount();
    const { button, cell } = dayOf(container, 12);

    expect(cell?.className).toContain("rdp-today");
    expect(fills(cell?.className)).toEqual([]);
    expect(button?.getAttribute("data-today")).toBe("true");
    expect(button?.className).toContain("data-[today=true]:after:bg-current");
    // The bar is today's alone.
    expect(dayOf(container, 11).button?.getAttribute("data-today")).not.toBe(
      "true",
    );
  });

  it("keeps a picked range's endpoints filled while today stays unfilled", async () => {
    const { container } = await mount({
      from: new Date(2026, 8, 1),
      to: new Date(2026, 8, 10),
    });

    expect(fills(dayOf(container, 1).cell?.className)).toContain("bg-muted");
    expect(dayOf(container, 1).button?.getAttribute("data-range-start")).toBe(
      "true",
    );
    expect(fills(dayOf(container, 12).cell?.className)).toEqual([]);
  });

  it("keeps the selected styling and the bar on a today that is a range endpoint", async () => {
    const { container } = await mount({
      from: today,
      to: new Date(2026, 8, 15),
    });
    const { button } = dayOf(container, 12);

    expect(button?.getAttribute("data-range-start")).toBe("true");
    expect(button?.getAttribute("data-today")).toBe("true");
  });
});
