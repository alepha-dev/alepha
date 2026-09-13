import { render } from "@testing-library/react";
import { Alepha } from "alepha";
import { AlephaContext } from "alepha/react";
import { AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { setupJsdomMocks } from "alepha/react/testing";
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
