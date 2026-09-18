import { $inject } from "alepha";
import { DatabaseProvider } from "alepha/orm";

import { frozenInvitations } from "../entities/frozen/invitations.ts";
import { frozenRankDefinitions } from "../entities/frozen/rankDefinitions.ts";
import { members } from "../entities/members.ts";

/**
 * Keeps Lore's three legacy organization tables in the migration snapshot
 * without exposing a queryable repository for any of them.
 *
 * Membership, ranks, and invitations moved to the `organization_*` tables.
 * The old tables remain on disk as historical data under Lore's freeze
 * convention. A future removal requires a separate migration decision.
 */
export class FrozenLegacyOrganizationTables {
  protected readonly database = $inject(DatabaseProvider);

  constructor() {
    this.database.registerEntity(members);
    this.database.registerEntity(frozenRankDefinitions);
    this.database.registerEntity(frozenInvitations);
  }
}
