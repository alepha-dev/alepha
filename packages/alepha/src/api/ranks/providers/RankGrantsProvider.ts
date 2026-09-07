import { $inject } from "alepha";
import {
  type ResourceGrantsDecision,
  ResourceGrantsProvider,
  type ResourceGrantsRequest,
} from "alepha/security";

import { RankService } from "../services/RankService.ts";
import { RankResourceProvider } from "./RankResourceProvider.ts";

/**
 * The implementation of `alepha/security`'s grants seam, filled by this
 * module.
 *
 * `$owns({ requires })` calls this with the rows it already read, and this
 * turns them into an allow or a deny. Registering the module is what
 * substitutes it; an application that never does keeps the permissive default
 * and behaves exactly as it did before `requires` existed.
 *
 * ⚠️ **It issues no query for the assignment**, and cannot: the request
 * carries rows, never ids. The only read is the scope's rank definitions, and
 * that one is cached and skipped entirely for a scope nobody has customised.
 */
export class RankGrantsProvider extends ResourceGrantsProvider {
  protected readonly ranks = $inject(RankService);
  protected readonly resources = $inject(RankResourceProvider);

  public override async check(
    request: ResourceGrantsRequest,
  ): Promise<ResourceGrantsDecision> {
    const rows = {
      authority: request.authority,
      membership: request.membership,
      user: request.user,
    };

    const found = this.resources.resolve(rows);

    // Not a rank scope at all. Whatever gate already ran is the whole answer,
    // which is what lets an application adopt ranks one resource at a time.
    if (!found) {
      return { allowed: true };
    }

    // A privileged identity is not narrowed by a rank, matching `$owns`'s own
    // `ownership === false` bypass. `$owns` returns before reaching here in
    // that case, so this is the imperative-parity branch rather than a second
    // gate.
    if (request.user.ownership === false) {
      return { allowed: true };
    }

    const resolved = await this.ranks.resolve(rows);

    if (!resolved) {
      return { allowed: true };
    }

    const missing = request.requires.filter(
      (permission) => !this.ranks.grants(resolved.permissions, permission),
    );

    if (!missing.length) {
      return { allowed: true };
    }

    return {
      allowed: false,
      message: await this.ranks.refusal(found.resource, {
        scopeId: found.scopeId,
        rank:
          resolved.key && resolved.name
            ? { key: resolved.key, name: resolved.name }
            : undefined,
        missing,
        user: request.user,
      }),
    };
  }
}
