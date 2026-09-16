import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { FakeProvider } from "../providers/FakeProvider.ts";

const personSchema = z.object({ firstName: z.string() });

describe("FakeProvider — locale option", () => {
  it("uses the configured locale when generating data", () => {
    const alepha = Alepha.create();
    const fake = alepha.inject(FakeProvider);

    const sample = (locale: string) => {
      fake.configure({ locale, seed: 42 });
      return Array.from(
        { length: 25 },
        () => fake.generate(personSchema).firstName,
      );
    };

    // Same seed, different locale — the option is documented as "Faker locale
    // to use for generating fake data", so it must actually change the corpus.
    expect(sample("fr")).not.toEqual(sample("en"));
  });

  /**
   * Locale-independent data (emoji, mime types, colours) lives only in
   * faker's `base` locale, so a chain without it throws rather than falling
   * back. `configure({ locale })` built `[locale, en]` and no base, which
   * meant switching locale broke any generator reaching that far - `bio()`
   * among them, which is what a field named `description` gets.
   */
  it("keeps the base locale in the chain when the locale changes", () => {
    const alepha = Alepha.create();
    const fake = alepha.inject(FakeProvider);

    fake.configure({ locale: "fr", seed: 42 });

    // Fifty draws with a fixed seed: `person.bio()` picks among templates and
    // only some carry an emoji, so one draw is not enough to reach the data
    // that lives in `base`.
    expect(() => {
      for (let i = 0; i < 50; i++) {
        fake.generate(z.object({ description: z.text() }));
      }
    }).not.toThrow();
  });
});
