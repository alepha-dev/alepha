import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { userPreferences } from "../entities/userPreferences.ts";
import { USER_PREFERENCE_MAX_BYTES } from "../schemas/userPreferenceSchema.ts";

/**
 * Each user's preferences (#Q4417): one `user_preferences` row per user and
 * key, read and written whole. A write is one upsert, so nothing needs a
 * transaction on D1, and the last write wins: two devices saving the same
 * table at once keep whichever landed second.
 */
export class UserPreferenceService {
  protected readonly preferences = $repository(userPreferences);

  /**
   * The value stored under `key`, or `null` when the user never wrote it.
   */
  public async get(
    userId: string,
    key: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.preferences.findOne({
      where: { userId: { eq: userId }, key: { eq: key } },
    });
    return row ? (row.value as Record<string, unknown>) : null;
  }

  /**
   * Replace the value stored under `key`. Refused (400) past
   * {@link USER_PREFERENCE_MAX_BYTES} of JSON.
   */
  public async set(
    userId: string,
    key: string,
    value: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const size = new TextEncoder().encode(JSON.stringify(value)).length;
    if (size > USER_PREFERENCE_MAX_BYTES) {
      throw new BadRequestError(
        `A preference holds at most ${USER_PREFERENCE_MAX_BYTES} bytes of JSON, this one ${size}.`,
      );
    }
    const row = await this.preferences.upsert(
      { userId, key, value },
      { target: ["userId", "key"] },
    );
    return row.value as Record<string, unknown>;
  }
}
