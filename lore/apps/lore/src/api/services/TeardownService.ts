import { $inject } from "alepha";
import { WorkerCloudflareAdapter } from "alepha/cli/platform-lib";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { BadRequestError } from "alepha/server";

import { type AppInstance, appInstances } from "../entities/appInstances.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import { DeployGate } from "./DeployGate.ts";

/**
 * What one copy still holds in its estate, as the deploy recorded it.
 */
export interface RecordedResources {
  worker?: string;
  d1?: { name: string; id: string };
  r2?: string;
  kv?: { name: string; id: string };
  queue?: string;
}

/**
 * Removing what a redeploy can put back, and keeping the database and bucket.
 *
 * ## ⚠️ Only what Lore can show it made
 *
 * Every resource is named from `(project, env)`, so the names are reproducible
 * and "recompute the name and delete it" is the obvious implementation. It is
 * also the wrong one, and the reason is the whole design: an **estate is
 * LENT**. Its Cloudflare account holds resources Lore never created, and one
 * of them may legitimately bear the name a copy would compute. `alepha
 * platform down` may delete by name - it runs on the operator's own machine,
 * against their own account, at their own typing. Lore holds a credential lent
 * for deploys, and deletes only what a deploy wrote down.
 *
 * A copy with no record is therefore **refused**, not guessed at: every copy
 * deployed before that recording existed has none.
 *
 * ## ⚠️ The record is struck as it goes, so a retry resumes
 *
 * Each resource that goes is removed from the copy's record immediately, one
 * write per success rather than one at the end. A run that removes four of six
 * and dies leaves a copy that still names the two that are left - so the
 * retry deletes those and nothing else, and no run ever tries to delete what
 * a previous one already did.
 */
export class TeardownService {
  protected readonly log = $logger();
  protected readonly instances = $repository(appInstances);
  protected readonly gate = $inject(DeployGate);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly adapter = $inject(WorkerCloudflareAdapter);

  /**
   * What this copy still holds, or nothing when it was never recorded.
   *
   * ⚠️ Absent and empty are different answers and must stay so. Absent is
   * "deployed before Lore recorded this", which nothing may act on; empty is
   * "a deploy ran and provisioned nothing", which is a complete answer.
   */
  public read(instance: AppInstance): RecordedResources | undefined {
    if (!instance.resources) {
      return undefined;
    }
    try {
      return JSON.parse(instance.resources) as RecordedResources;
    } catch {
      return undefined;
    }
  }

  /**
   * Whether this copy has anything of Lore's left in its estate.
   */
  public holdsResources(instance: AppInstance): boolean {
    const record = this.read(instance);
    return !!record && Object.keys(record).length > 0;
  }

  /**
   * Delete what this copy recorded, and answer what went and what did not.
   */
  public async destroy(instance: AppInstance): Promise<{
    removed: string[];
    kept: string[];
    failed: Array<{ resource: string; message: string }>;
  }> {
    const record = this.read(instance);
    if (!record) {
      throw new BadRequestError(
        `Lore has no record of what it created for ${instance.app}/${instance.env}, so it will not delete anything: the names are derived and an estate holds resources Lore never made. Deploy it once to record them, or remove them with \`alepha platform down\` or from the Cloudflare dashboard.`,
      );
    }
    if (Object.keys(record).length === 0) {
      return { removed: [], kept: [], failed: [] };
    }

    // ⚠️ The same gate a deploy applies. Removing what a copy holds is at
    // least as consequential as adding to it, so it answers to the same
    // question: is this estate still lent, still allowed, still credentialed.
    const estate = await this.gate.assert(instance);

    // ⚠️ A `bay` estate has no Cloudflare credential at all, and these are
    // Cloudflare resources. Refused by name rather than cast through, because
    // the alternative is a teardown that reports success having called
    // nothing.
    if (!estate.credential || !estate.accountId) {
      throw new BadRequestError(
        `The estate '${estate.slug}' has no Cloudflare credential, so Lore cannot remove what ${instance.app}/${instance.env} holds there.`,
      );
    }

    const result = await this.adapter
      .use({
        apiToken: this.seal.open(
          estate.credential,
          CredentialSealService.ESTATE_PURPOSE,
        ),
        accountId: estate.accountId,
      })
      .teardownRecorded(record);

    await this.strike(instance.id, record, result.removed);
    return result;
  }

  /**
   * Remove from the record exactly what went, keeping the rest.
   *
   * ⚠️ Written even when everything failed, and written as the REMAINDER
   * rather than as a flag: the next run reads this and deletes what is left,
   * so a partial teardown converges instead of retrying its own successes -
   * which would answer "already gone" errors that are indistinguishable from
   * a delete that never worked.
   */
  protected async strike(
    instanceId: string,
    record: RecordedResources,
    removed: string[],
  ): Promise<void> {
    const remaining: RecordedResources = { ...record };
    for (const resource of removed) {
      delete remaining[resource as keyof RecordedResources];
    }
    await this.instances.updateById(instanceId, {
      resources: JSON.stringify(remaining),
    });
  }
}
