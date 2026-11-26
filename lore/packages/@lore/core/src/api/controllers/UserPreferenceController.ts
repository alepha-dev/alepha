import { $inject } from "alepha";
import { $secure } from "alepha/security";
import { $action } from "alepha/server";

import {
  userPreferenceParamsSchema,
  userPreferenceSchema,
  userPreferenceWriteSchema,
} from "../schemas/userPreferenceSchema.ts";
import { UserPreferenceService } from "../services/UserPreferenceService.ts";

/**
 * The caller's own preferences kept on the server (#Q4417), one JSON object
 * per key: what a DataTable remembers under its `persistenceKey`, so it
 * follows the reader to another device.
 *
 * Behind a bare `$secure()`, like the dock: no user id travels in any path,
 * so the session decides the row. The writes refuse a machine credential
 * (`sessionOnly`), as every non-GET under `/users/me` does: a table's filters
 * are a person's preference, not an agent's.
 */
export class UserPreferenceController {
  protected readonly preferences = $inject(UserPreferenceService);

  getMyPreference = $action({
    method: "GET",
    path: "/users/me/preferences/:key",
    use: [$secure()],
    description:
      "Read one of the caller's preferences; `value` is null when never written",
    schema: {
      params: userPreferenceParamsSchema,
      response: userPreferenceSchema,
    },
    handler: async ({ params, user }) => ({
      key: params.key,
      value: await this.preferences.get(user.id, params.key),
    }),
  });

  setMyPreference = $action({
    method: "PUT",
    path: "/users/me/preferences/:key",
    use: [$secure({ sessionOnly: true })],
    description: "Replace one of the caller's preferences",
    schema: {
      params: userPreferenceParamsSchema,
      body: userPreferenceWriteSchema,
      response: userPreferenceSchema,
    },
    handler: async ({ params, body, user }) => ({
      key: params.key,
      value: await this.preferences.set(user.id, params.key, body.value),
    }),
  });
}
