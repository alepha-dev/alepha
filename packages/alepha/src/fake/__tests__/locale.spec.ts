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
});
