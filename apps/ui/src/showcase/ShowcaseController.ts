import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { showcaseMemberQuerySchema } from "./schemas/showcaseMemberQuerySchema.ts";
import { showcaseMemberSchema } from "./schemas/showcaseMemberSchema.ts";
import { showcaseMemberStatsSchema } from "./schemas/showcaseMemberStatsSchema.ts";
import { ShowcaseMembers } from "./ShowcaseMembers.ts";

/**
 * The showcase's entire server: two actions over an in-memory array.
 *
 * There is no ORM here, no migration, no realm and no session - but there IS a
 * real `$action`, and that is deliberate. Two cheaper-looking approaches were
 * built first and both failed against the real client:
 *
 *   1. An `HttpClient` subclass faking `GET /api/_links` and `POST /api/_batch`.
 *      Its unit tests passed and the browser still said "Action not found":
 *      the browser never fetches the registry, it reads the one SSR seeded
 *      into the store, and that is built from the server's registered links.
 *   2. Registering the fixtures with `LinkProvider.registerLink`. That fixed
 *      the registry and SSR, but a link is not an HTTP route - and
 *      `BatchCollector` skips batching when only one call is pending, issuing
 *      a direct request that 404s.
 *
 * An `$action` is a registry entry, an in-process handler for SSR and a real
 * route, all at once, so every path a component can take resolves. Nothing
 * here impersonates the framework; the fixtures are simply what the handlers
 * return.
 *
 * ⚠️ `schema.response` is what serializes. A field added to
 * `showcaseMemberSchema`'s type but not to the schema never reaches the
 * browser, and it fails silently.
 */
export class ShowcaseController {
  protected readonly members = $inject(ShowcaseMembers);

  public readonly findShowcaseMembers = $action({
    path: "/showcase/members",
    description: "Paged, filtered and sorted showcase members",
    schema: {
      query: showcaseMemberQuerySchema,
      response: z.page(showcaseMemberSchema),
    },
    handler: ({ query }) => this.members.paginate(query),
  });

  public readonly findShowcaseMemberStats = $action({
    path: "/showcase/members/stats",
    description: "Aggregate counts over the showcase members",
    schema: {
      response: showcaseMemberStatsSchema,
    },
    handler: () => this.members.stats(),
  });
}
