import { render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaLogger } from "alepha/logger";
import { AlephaContext } from "alepha/react";
import { useForm } from "alepha/react/form";
import { $dictionary, AlephaReactI18n, I18nProvider } from "alepha/react/i18n";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { uiFr } from "../../i18n/fr/uiFr.ts";
import { Control } from "../Control.tsx";

/**
 * The date controls speak the page's language, not the browser's (#Q2392).
 *
 * Both printed a picked date with `toLocaleDateString()` and no locale, so
 * they followed the browser: an English browser on a French page showed
 * `9/10/2026 - 9/12/2026` for 10 to 12 September, which a French reader
 * reads as the 9th of October. Their empty triggers said "Pick a date" and
 * "Pick a date range" whatever the catalogue held.
 *
 * jsdom's own locale is English, so the French cases below can only pass
 * through the i18n language, and the English ones pin that nothing changed
 * for an application without a French catalogue.
 */
describe("date controls follow the i18n language", () => {
  let alepha: Alepha | undefined;

  beforeAll(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  class Catalogues {
    en = $dictionary({ lazy: async () => ({ default: {} }) });
    // The real catalogue, so a key renamed on one side only goes red here.
    fr = $dictionary({ lazy: async () => ({ default: uiFr }) });
  }

  const Probe = (props: { day?: string; range?: string[] }) => {
    const form = useForm({
      schema: z.object({
        day: z.date().optional(),
        range: z.dateRange().optional(),
      }),
      initialValues: { day: props.day, range: props.range },
      handler: () => {},
    });
    return (
      <>
        <Control input={form.input.day} />
        <Control input={form.input.range} />
      </>
    );
  };

  const mount = async (
    lang: "en" | "fr",
    values: { day?: string; range?: string[] } = {},
  ) => {
    alepha = Alepha.create().with(AlephaLogger).with(AlephaReactI18n);
    alepha.inject(Catalogues);
    await alepha.start();
    await alepha.inject(I18nProvider).setLang(lang);
    render(
      <AlephaContext.Provider value={alepha}>
        <Probe day={values.day} range={values.range} />
      </AlephaContext.Provider>,
    );
  };

  const triggers = () =>
    [...document.querySelectorAll('[data-slot="date-trigger"]')].map(
      (el) => el.textContent ?? "",
    );

  it("prints picked days day-first on a French page", async () => {
    await mount("fr", {
      day: "2026-09-10",
      range: ["2026-09-10", "2026-09-12"],
    });

    await waitFor(() =>
      expect(triggers()).toEqual(["10/09/2026", "10/09/2026 - 12/09/2026"]),
    );
  });

  it("prints them month-first on an English page, as before", async () => {
    await mount("en", {
      day: "2026-09-10",
      range: ["2026-09-10", "2026-09-12"],
    });

    await waitFor(() =>
      expect(triggers()).toEqual(["9/10/2026", "9/10/2026 - 9/12/2026"]),
    );
  });

  it("names the empty triggers from the catalogue", async () => {
    await mount("fr");

    await waitFor(() =>
      expect(triggers()).toEqual(["Choisir une date", "Choisir une période"]),
    );
  });

  it("keeps the English placeholders without a catalogue", async () => {
    await mount("en");

    await waitFor(() =>
      expect(triggers()).toEqual(["Pick a date", "Pick a date range"]),
    );
  });
});
