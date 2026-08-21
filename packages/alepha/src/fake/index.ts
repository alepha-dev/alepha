import { $module } from "alepha";

import { FakeProvider } from "./providers/FakeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { faker as fake } from "@faker-js/faker";
export * from "./providers/FakeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Test data generation with Faker.js.
 *
 * **Features:**
 * - Zod schema-based generation
 * - Context-aware field generation (email field -> email address)
 * - Test data seeding
 *
 * @module alepha.fake
 */
export const AlephaFake = $module({
  name: "alepha.fake",
  services: [FakeProvider],
});
