import { $module } from "alepha";
import { FakeProvider } from "./providers/FakeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { faker as fake } from "@faker-js/faker";
export * from "./providers/FakeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides fake data generation capabilities for Alepha applications using faker.js and TypeBox schemas.
 *
 * The fake module enables declarative fake data generation from TypeBox schemas, making it easy to create
 * realistic test data, seed databases, or generate mock responses. It intelligently uses property key names
 * to generate contextually appropriate data (e.g., "email" generates an email address, "firstName" generates
 * a first name).
 *
 * @see {@link FakeProvider}
 * @module alepha.fake
 */
export const AlephaFake = $module({
  name: "alepha.fake",
  services: [FakeProvider],
});
