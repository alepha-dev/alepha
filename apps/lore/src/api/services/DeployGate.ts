import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import type { AppInstance } from "../entities/appInstances.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { EstateCloudflareService } from "./EstateCloudflareService.ts";

/**
 * Everything that has to be true before a deploy has a single side effect.
 *
 * ## ⚠️ Nothing on the wire names an estate, and that is structural
 *
 * The estate is read from the `app_instances` row and from nowhere else. An
 * endpoint, an MCP tool or a CLI flag that accepts an estate id or slug from a
 * client is the bug however carefully it validates: a project owner would type
 * somebody else's estate name and their deploy would land in that person's
 * Cloudflare account, on that person's token, with the server complying because
 * it only checked that the estate exists. Folio #96 named that hole; it came
 * back the moment estates became user-owned and lent to several projects, and
 * `deploy-gate.spec.ts` is what keeps it shut.
 *
 * That is also why there is **no `--estate` flag, ever** (epic #1's own words),
 * and why this class takes an instance rather than an estate.
 *
 * ## The caller half is one `$ownsProject` call, not a check in here
 *
 * ```ts
 * $ownsProject({ param: "projectId", owner: true, capability: { key: "apps", option: "deploy" } })
 * ```
 *
 * ⚠️ **One call, so Ranks (#E39) has one place to move to.** `owner: true`
 * because deploying into somebody's cloud account is the most powerful action
 * in Lore and widening it later is one line; the capability option because a
 * project that does not deploy through Lore should not have the endpoint at
 * all. Both live on the middleware rather than here, so a page and an endpoint
 * cannot disagree about which gates apply.
 *
 * ⚠️ The capability is a WRITE gate. Reading past `deployments` rows must not
 * take it, or a project that turns `deploy` off gets errors where it meant to
 * get an empty tab.
 *
 * ## The order is cheapest-first, and each clause answers a different question
 *
 * 1. the instance has an estate at all
 * 2. the estate still exists
 * 3. the **lending still stands** - `estate_projects` is a delete and not a
 *    cascade onto `app_instances`, so an instance can outlive the grant that
 *    let it point there
 * 4. `deployAllowed`, the owner's kill switch
 * 5. `credentialStatus`, for the estate types that have a credential
 *
 * ⚠️ **`NamingService` derives every resource as `<project>-<env>`**, so a
 * deploy that passes here resolves the LIVE D1, the live R2 and the live
 * Worker of that name. There is no sandbox between a valid caller and
 * production, which is why every clause refuses rather than warns.
 */
export class DeployGate {
  protected readonly estates = $repository(estates);
  protected readonly grants = $repository(estateProjects);
  protected readonly cloudflare = $inject(EstateCloudflareService);

  /**
   * The estate this instance may deploy to, or a refusal saying why not.
   *
   * ⚠️ Returns the estate rather than a boolean, so a caller cannot pass the
   * gate and then resolve the estate a second way. One read, one answer.
   */
  public async assert(instance: AppInstance): Promise<Estate> {
    if (!instance.estateId) {
      throw new BadRequestError(
        `${instance.app}/${instance.env} has no estate, so there is nowhere to deploy it. Choose one on its Settings tab.`,
      );
    }

    const estate = await this.estates.findById(instance.estateId);
    if (!estate) {
      throw new BadRequestError(
        "The estate this copy deploys to is gone. Lend one again on the project's Estates page.",
      );
    }

    // ⚠️ Re-checked at deploy time even though `AppService.setEstate` proved it
    // at write time. A lending can be revoked afterwards, and revoking it does
    // not cascade onto `app_instances` - so the column can name an estate this
    // project no longer holds.
    const grant = await this.grants.findOne({
      where: {
        estateId: { eq: estate.id },
        projectId: { eq: instance.projectId },
      },
    });
    if (!grant) {
      throw new NotFoundError(
        `The estate '${estate.slug}' is no longer lent to this project, so it cannot deploy there. Ask its owner to lend it again.`,
      );
    }

    if (!estate.deployAllowed) {
      // ⚠️ The message names WHOSE estate it is, because the person deploying
      // is often not the person who can flip this. A Cloudflare estate is
      // created with it on; a Bay machine is stats-only until its owner says
      // otherwise, so this is the clause that routinely fires there.
      throw new BadRequestError(
        `The estate '${estate.slug}' does not accept deploys. Its owner can turn that on from their Estates page.`,
      );
    }

    // ⚠️ Last, and only for the types that have one. `credentialStatus` is
    // `undefined` for a `bay` estate rather than `"valid"`, so testing for
    // `!== "valid"` would refuse every Bay deploy for having no Cloudflare
    // credential.
    if (this.cloudflare.credentialStatus(estate) === "invalid") {
      throw new BadRequestError(
        `The estate '${estate.slug}' does not have a usable Cloudflare credential. Its owner can check it from their Estates page.`,
      );
    }

    return estate;
  }
}
