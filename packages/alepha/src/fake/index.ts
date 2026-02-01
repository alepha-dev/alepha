import { $module } from "alepha";
import { FakeProvider } from "./providers/FakeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { faker as fake } from "@faker-js/faker";
export * from "./providers/FakeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.11.0 | node, bun, workerd, browser|
 *
 * Test data generation with Faker.js.
 *
 * **Features:**
 * - TypeBox schema-based generation
 * - Context-aware field generation (email field -> email address)
 * - Test data seeding
 *
 * @module alepha.fake
 */
export const AlephaFake = $module({
  name: "alepha.fake",
  services: [FakeProvider],
});
