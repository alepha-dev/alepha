import type { Infer } from "alepha";

import { userPreferences } from "../entities/userPreferences.ts";

export { USER_PREFERENCE_KEY_PATTERN } from "../entities/userPreferences.ts";

/**
 * The most a preference's value may weigh, as JSON. A table's state is a few
 * hundred bytes; the cap is what keeps a preference from becoming a store.
 */
export const USER_PREFERENCE_MAX_BYTES = 16_384;

/**
 * The path of every preference action: the key alone, as the column has it.
 */
export const userPreferenceParamsSchema = userPreferences.schema.pick({
  key: true,
});

/**
 * One preference as the actions answer it. `value` departs from the column
 * on purpose: it is `null` when the caller never wrote this key (there is no
 * row), and an object (possibly empty) once they have.
 */
export const userPreferenceSchema = userPreferenceParamsSchema.extend({
  value: userPreferences.schema.shape.value.nullable(),
});

export type UserPreferenceResource = Infer<typeof userPreferenceSchema>;

export const userPreferenceWriteSchema = userPreferences.schema.pick({
  value: true,
});
