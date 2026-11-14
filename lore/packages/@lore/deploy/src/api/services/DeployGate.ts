import { $inject } from "alepha";
import { $repository } from "alepha/orm";
import { BadRequestError, NotFoundError } from "alepha/server";

import type { AppInstance } from "../entities/appInstances.ts";
import { hostProjects } from "../entities/hostProjects.ts";
import { type Host, hosts } from "../entities/hosts.ts";
import { HostCloudflareService } from "./HostCloudflareService.ts";
import { HostService } from "./HostService.ts";

/**
 * Everything that has to be true before a deploy has a single side effect.
 *
 * ## ⚠️ Nothing on the wire names a host, and that is structural
 *
 * The host is read from the `app_instances` row and from nowhere else. An
 * endpoint, an MCP tool or a CLI flag that accepts a host id or slug from a
 * client is the bug however carefully it validates: a project owner would type
 * somebody else's host name and their deploy would land in that person's
 * Cloudflare account, on that person's token, with the server complying because
 * it only checked that the host exists. Folio #96 named that hole; it came
 * back the moment hosts became user-owned and lent to several projects, and
 * `deploy-gate.spec.ts` is what keeps it shut.
 *
 * That is also why there is **no `--host` flag, ever** (epic #1's own words),
 * and why this class takes an instance rather than a host.
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
 * 1. the instance has a host at all
 * 2. the host still exists
 * 3. the **lending still stands** - `host_projects` is a delete and not a
 *    cascade onto `app_instances`, so an instance can outlive the grant that
 *    let it point there
 * 4. `deployAllowed`, the owner's kill switch
 * 5. `credentialStatus`, for the host types that have a credential
 * 6. the artifact's **runtime**, which is last because it is the only clause
 *    that needs the artifact row
 *
 * ⚠️ **`NamingService` derives every resource as `<project>-<env>`**, so a
 * deploy that passes here resolves the LIVE D1, the live R2 and the live
 * Worker of that name. There is no sandbox between a valid caller and
 * production, which is why every clause refuses rather than warns.
 */
export class DeployGate {
  protected readonly hosts = $repository(hosts);
  protected readonly grants = $repository(hostProjects);
  protected readonly cloudflare = $inject(HostCloudflareService);
  protected readonly hostService = $inject(HostService);

  /**
   * The host this instance may deploy to, or a refusal saying why not.
   *
   * ⚠️ Returns the host rather than a boolean, so a caller cannot pass the
   * gate and then resolve the host a second way. One read, one answer.
   */
  public async assert(instance: AppInstance): Promise<Host> {
    if (!instance.hostId) {
      throw new BadRequestError(
        `${instance.app}/${instance.env} has no host, so there is nowhere to deploy it. Choose one on its Settings tab.`,
      );
    }

    const host = await this.hosts.findById(instance.hostId);
    if (!host) {
      throw new BadRequestError(
        "The host this copy deploys to is gone. Lend one again on the project's Hosts page.",
      );
    }

    // ⚠️ Re-checked at deploy time even though `AppService.setHost` proved it
    // at write time. A lending can be revoked afterwards, and revoking it does
    // not cascade onto `app_instances` - so the column can name a host this
    // project no longer holds.
    const grant = await this.grants.findOne({
      where: {
        hostId: { eq: host.id },
        projectId: { eq: instance.projectId },
      },
    });
    if (!grant) {
      throw new NotFoundError(
        `The host '${host.slug}' is no longer lent to this project, so it cannot deploy there. Ask its home project to lend it again.`,
      );
    }

    if (!host.deployAllowed) {
      // ⚠️ The message names WHOSE host it is, because the person deploying
      // is often not the person who can flip this. A Cloudflare host is
      // created with it on; a Bay machine is stats-only until its home project says
      // otherwise, so this is the clause that routinely fires there.
      throw new BadRequestError(
        `The host '${host.slug}' does not accept deploys. Somebody with host:update in its home project can turn that on from its console.`,
      );
    }

    // ⚠️ Last, and only for the types that have one. `credentialStatus` is
    // `undefined` for a `bay` host rather than `"valid"`, so testing for
    // `!== "valid"` would refuse every Bay deploy for having no Cloudflare
    // credential.
    if (this.cloudflare.credentialStatus(host) === "invalid") {
      throw new BadRequestError(
        `The host '${host.slug}' does not have a usable Cloudflare credential. Somebody with host:update in its home project can check it from its console.`,
      );
    }

    return host;
  }

  /**
   * Whether this host can run these bytes at all.
   *
   * ## ⚠️ Nothing checked this before, and the failure was expensive
   *
   * Push a `node` artifact, deploy it to a Cloudflare host, and you get a
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
   * `alepha build --runtime=workerd && alepha lore artifacts push`, and both halves
   * changed. The spec pins the string, so #1812 and this cannot silently
   * disagree.
   *
   * `artifacts.runtimes` is read from the manifest at push time, and
   * `acceptedRuntimes` is a property of the host's TYPE rather than of the
   * row.
   */
  public assertRuntime(input: {
    host: Host;
    app: string;
    tag: string;
    /**
     * Every slice the chosen archive carries, in declared order (#Q2462). A
     * `node,workerd` archive passes for a Bay AND for a Cloudflare account.
     */
    runtimes: string[];
    /**
     * The runtimes this app has actually built for this tag, across its
     * archives, so the refusal can tell "wrong variant" from "no variant at
     * all".
     *
     * ⚠️ **Archive runtimes only.** An image row carries a real `runtime`, so
     * feeding every variant here makes a refusal read "It has: node, node" for
     * a tag with a node tarball and a node image - and worse, would claim a
     * `node` build exists for a tag whose only node artifact is an image
     * nothing can deploy. See {@link assertDeployable}.
     */
    available: string[];
  }): void {
    const accepted = this.hostService.acceptedRuntimes(input.host.type);
    if (input.runtimes.some((runtime) => accepted.includes(runtime))) {
      return;
    }

    const wanted = accepted[0] ?? "unknown";
    if (input.available.includes(wanted)) {
      throw new BadRequestError(
        `Artifact ${input.app}@${input.tag} carries \`${input.runtimes.join("`, `")}\`; host '${input.host.slug}' (${input.host.type}) runs \`${accepted.join("`, `")}\`.`,
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
   * No host type can run an image today: `acceptedRuntimes` is `bay` to
   * `["node"]` and `cloudflare` to `["workerd"]`, and Bay runs Node under
   * systemd rather than containers. The day one can, this is the method that
   * learns about it.
   */
  public assertDeployable(input: {
    host: Host;
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
      `${input.app}@${input.tag} exists only as a container image${shown}, and Lore cannot deploy an image: host '${input.host.slug}' (${input.host.type}) runs \`${this.hostService.acceptedRuntimes(input.host.type).join("`, `")}\` from a packed build. Push one with \`lore artifacts push\`.`,
    );
  }
}
