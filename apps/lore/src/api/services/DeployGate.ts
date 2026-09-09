import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import type { AppInstance } from "../entities/appInstances.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, estates } from "../entities/estates.ts";
import { EstateCloudflareService } from "./EstateCloudflareService.ts";
import { EstateService } from "./EstateService.ts";

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
 * 6. the artifact's **runtime**, which is last because it is the only clause
 *    that needs the artifact row
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
  protected readonly estateService = $inject(EstateService);

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

  /**
   * Whether this estate can run these bytes at all.
   *
   * ## ⚠️ Nothing checked this before, and the failure was expensive
   *
   * Push a `node` artifact, deploy it to a Cloudflare estate, and you get a
   * broken Worker or a confusing failure deep in the deploy - after an upload
   * has already happened. `manifest.json`'s own doc names the shape of it:
   * "`runtime: node`, spawn a process against a directory with no entry point".
   *
   * ## The error IS the deliverable
   *
   * Two messages, and both name the missing thing rather than saying "not
   * found". The second is what makes the multi-variant model usable: a deploy
   * is a LOOKUP - `artifacts` is unique on `(projectId, app, tag, runtime)`, so
   * one tag names one row per runtime - and a miss has to say exactly which
   * build to produce. It is also the message a Bay deploy hits when the project
   * has only ever built for Cloudflare.
   *
   * ⚠️ The command in that message names `lore apps build`, which is #1812's
   * surface. It has drifted once already: the pre-#27 spelling was
   * `alepha build -t cloudflare && alepha lore artifacts push`, and both halves
   * changed. The spec pins the string, so #1812 and this cannot silently
   * disagree.
   *
   * Neither side needed new storage: `artifacts.runtime` is read from the
   * manifest at push time, and `acceptedRuntimes` is a property of the estate's
   * TYPE rather than of the row.
   */
  public assertRuntime(input: {
    estate: Estate;
    app: string;
    tag: string;
    runtime: string;
    /**
     * The runtimes this app has actually built for this tag, so the refusal
     * can tell "wrong variant" from "no variant at all".
     *
     * ⚠️ **Archive runtimes only.** An image row carries a real `runtime`, so
     * feeding every variant here makes a refusal read "It has: node, node" for
     * a tag with a node tarball and a node image - and worse, would claim a
     * `node` build exists for a tag whose only node artifact is an image
     * nothing can deploy. See {@link assertDeployable}.
     */
    available: string[];
  }): void {
    const accepted = this.estateService.acceptedRuntimes(input.estate.type);
    if (accepted.includes(input.runtime)) {
      return;
    }

    const wanted = accepted[0] ?? "unknown";
    if (input.available.includes(wanted)) {
      throw new BadRequestError(
        `Artifact ${input.app}@${input.tag} is a \`${input.runtime}\` build; estate '${input.estate.slug}' (${input.estate.type}) runs \`${accepted.join("`, `")}\`.`,
      );
    }

    throw new BadRequestError(
      `${input.app}@${input.tag} has no \`${wanted}\` build. Run \`lore apps build --tag ${input.tag} --env <env>\`, then \`lore artifacts push\`.`,
    );
  }

  /**
   * Refuse a tag whose only variants are images, by name.
   *
   * ⚠️ **This exists so the deploy path can filter AFTER the query rather
   * than inside it.** Reading only `format: archive` rows would make a tag
   * whose sole variant is an image answer "has no artifact tagged '0.30.0'.
   * Push one with `lore artifacts push`" - which is a lie told to somebody who
   * pushed one thirty seconds ago, and sends them to push it again.
   *
   * So the caller reads every variant, partitions on `format`, and calls this
   * when the archive list came back empty and the image list did not. It lives
   * beside {@link assertRuntime} because that is where the other two named
   * refusals live, and a refusal that names the actual state is the whole
   * deliverable of all three.
   *
   * No estate type can run an image today: `acceptedRuntimes` is `bay` to
   * `["node"]` and `cloudflare` to `["workerd"]`, and Bay runs Node under
   * systemd rather than containers. The day one can, this is the method that
   * learns about it.
   */
  public assertDeployable(input: {
    estate: Estate;
    app: string;
    tag: string;
    /**
     * The references of the image variants under this tag, so the refusal can
     * show what the tag DOES have. Never empty when this is called.
     */
    images: Array<string | undefined>;
  }): never {
    const named = input.images.filter((it): it is string => Boolean(it));
    const shown = named.length ? ` (${named.join(", ")})` : "";
    throw new BadRequestError(
      `${input.app}@${input.tag} exists only as a container image${shown}, and Lore cannot deploy an image: estate '${input.estate.slug}' (${input.estate.type}) runs \`${this.estateService.acceptedRuntimes(input.estate.type).join("`, `")}\` from a packed build. Push one with \`lore artifacts push\`.`,
    );
  }
}
