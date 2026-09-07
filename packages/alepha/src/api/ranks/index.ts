import { $module } from "alepha";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, ResourceGrantsProvider } from "alepha/security";

import { currentRankAtom } from "./atoms/currentRankAtom.ts";
import { RankController } from "./controllers/RankController.ts";
import { $rankResource } from "./primitives/$rankResource.ts";
import { RankGrantsProvider } from "./providers/RankGrantsProvider.ts";
import { RankResourceProvider } from "./providers/RankResourceProvider.ts";
import { RankService } from "./services/RankService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./atoms/currentRankAtom.ts";
export * from "./controllers/RankController.ts";
export * from "./entities/rankDefinitions.ts";
export * from "./primitives/$rankResource.ts";
export * from "./providers/RankGrantsProvider.ts";
export * from "./providers/RankResourceProvider.ts";
export * from "./schemas/rankResourceSchema.ts";
export * from "./services/RankService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A rank: the permission set somebody holds inside one scope.
 *
 * **Features:**
 * - Ranks declared in code, customised as rows, only when customised
 * - A permission set that narrows an application permission and never widens it
 * - The assignment as a column on a row the request already reads: zero queries
 * - Definitions cached and disclosed, assignments never cached, so revocation is instant
 * - Invariants on the write path: no self-escalation, no self-lockout, never `admin:*`
 * - An HTTP surface for the editor, gated by the application's own closures
 *
 * Roles say what kind of user somebody is, across the whole application. That
 * cannot answer what a member may do inside ONE project, club or workspace,
 * because the answer differs per scope for the same person. A rank does.
 *
 * The module knows nothing about the scope. Declare one `$rankResource` per
 * kind to tell it what a scope is, where the assignment column lives, which
 * ranks exist by default and who may edit them.
 *
 * ## ⚠️ It never owns the assignment
 *
 * There is no `(userId, scopeId, rank)` table here, and adding one would make
 * every authenticated request in every consuming application pay a read
 * forever. The assignment is a column on a row the application already loads,
 * and `$rankResource.rank` is synchronous precisely so there is nowhere to
 * put a query.
 *
 * ## Effective access
 *
 * `application permission AND rank permission`, narrowing only. The two
 * registries stay separate: merging them would let the owner of one scope
 * grant themselves `admin:*`.
 *
 * @module alepha.api.ranks
 */
export const AlephaApiRanks = $module({
  name: "alepha.api.ranks",
  imports: [AlephaOrm, AlephaSecurity],
  primitives: [$rankResource],
  atoms: [currentRankAtom],
  services: [RankResourceProvider, RankService, RankController],
  register: (alepha) => {
    // Registering this module IS the substitution: `$owns({ requires })` asks
    // `ResourceGrantsProvider`, whose default allows, and this replaces it
    // with the one that reads a rank. An application that does not register
    // the module keeps today's behaviour exactly, whether or not its call
    // sites name a permission.
    //
    // Not `optional`. A substitution that arrives after the provider has been
    // constructed is skipped silently under `optional: true`, and a silently
    // skipped grants provider means every `requires` in the application
    // allows - the one failure mode this module must never have. Loud is
    // correct here: `ResourceGrantsProvider` is deliberately NOT in
    // `AlephaSecurity.services` and `$owns` injects it per request, so
    // nothing constructs it before registration in the normal case.
    alepha.with({
      provide: ResourceGrantsProvider,
      use: RankGrantsProvider,
    });
  },
});
