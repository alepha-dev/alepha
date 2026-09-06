import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbConflictError } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import {
  BadRequestError,
  ConflictError,
  HttpError,
  NotFoundError,
} from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, type EstateType, estates } from "../entities/estates.ts";
import { projects } from "../entities/projects.ts";
import {
  type EstateResource,
  estateResourceSchema,
} from "../schemas/estateResourceSchema.ts";
import {
  ESTATE_SLUG_MAX_LENGTH,
  ESTATE_SLUG_PATTERN,
} from "../schemas/estateSlugSchema.ts";
import {
  ESTATE_PROTOCOL_VERSION,
  type EstateWelcomeFrame,
} from "../schemas/estateWelcomeFrameSchema.ts";
import type { OwnedEstateResource } from "../schemas/ownedEstateResourceSchema.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import { EstateCloudflareService } from "./EstateCloudflareService.ts";
import { EstateInventoryService } from "./EstateInventoryService.ts";
import { EstateTokenService } from "./EstateTokenService.ts";
import { LoreAudits } from "./LoreAudits.ts";

/**
 * What an estate IS, stated once: which runtimes its type runs, when it
 * counts as online, what may be read off it, how one is minted, and what
 * stands in the way of deleting it.
 *
 * The rules here are the ones folio #1194 fixed on 2026-09-04, and the
 * owner's controller, the project-side lending (#1837), the admin backstop
 * (#1838) and the app instances that point at an estate (#1767) all read them
 * from here rather than restating them.
 */
export class EstateService {
  protected readonly estates = $repository(estates);
  protected readonly instances = $repository(appInstances);
  protected readonly grants = $repository(estateProjects);
  protected readonly projects = $repository(projects);
  protected readonly tokens = $inject(EstateTokenService);
  protected readonly inventories = $inject(EstateInventoryService);
  protected readonly seal = $inject(CredentialSealService);
  protected readonly cloudflare = $inject(EstateCloudflareService);
  protected readonly audits = $inject(LoreAudits);
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How many instances {@link assertUnreferenced} names before it counts the
   * rest. Enough to act on, short of a paragraph.
   */
  protected readonly referenceNameLimit = 5;

  /**
   * The runtimes an estate of this type can run, which is what epic #1's
   * runtime gate (#1598) refuses an artifact against.
   *
   * A property of the type, not of the row: a `bay` runs a Node process, a
   * `cloudflare` account runs a Worker, and nothing an owner can set changes
   * either.
   */
  acceptedRuntimes(type: EstateType): string[] {
    return type === "bay" ? ["node"] : ["workerd"];
  }

  /**
   * Whether the machine is connected right now, from the row's stamps.
   *
   * `connectedAt > disconnectedAt` says a connection opened and has not been
   * seen closing. That alone is not enough: the Durable Object hosting the
   * socket can lose the close event, so the second clause requires a frame
   * within twice the stats interval, which is the longest a healthy
   * connection stays silent. A machine that stopped pushing is offline
   * whatever the first clause says.
   */
  isOnline(estate: Estate, now = this.dateTime.nowMillis()): boolean {
    if (!estate.connectedAt) {
      return false;
    }
    const connected = Date.parse(estate.connectedAt);
    const disconnected = estate.disconnectedAt
      ? Date.parse(estate.disconnectedAt)
      : 0;
    if (!(connected > disconnected)) {
      return false;
    }
    const seen = estate.lastSeenAt ? Date.parse(estate.lastSeenAt) : connected;
    return now - seen <= estate.statsIntervalSeconds * 2 * 1000;
  }

  /**
   * What a machine is told about its estate: the `welcome` on connect and
   * the `config` on every switch change, same fields, wire format v1.
   */
  welcomeFrame(
    estate: Estate,
    type: EstateWelcomeFrame["type"],
  ): EstateWelcomeFrame {
    return {
      type,
      protocol: ESTATE_PROTOCOL_VERSION,
      estate: { id: estate.id, slug: estate.slug },
      deployAllowed: estate.deployAllowed,
      statsIntervalSeconds: estate.statsIntervalSeconds,
    };
  }

  /**
   * Projects a row into what its owner may see.
   *
   * No credential crosses, of either kind: `estateResourceSchema` is a
   * `pick` allowlist and parsing strips everything outside it, so a column
   * added to the row reaches a browser only when somebody adds a line there
   * on purpose (#1629).
   */
  toResource(estate: Estate): EstateResource {
    return estateResourceSchema.parse({
      ...estate,
      online: this.isOnline(estate),
      acceptedRuntimes: this.acceptedRuntimes(estate.type),
      credentialStatus: this.cloudflare.credentialStatus(estate),
    });
  }

  /**
   * Mints a `bay` estate for its owner, and hands back the only cleartext
   * copy of its secret that will ever exist.
   *
   * One path for the account page and for "create it from inside a project"
   * (#1837), so the two cannot disagree about normalisation, uniqueness or
   * the audit row. `(ownerUserId, slug)` is unique: the `findOne` in
   * {@link claimSlug} names the clash in a message the owner reads, and the
   * `DbConflictError` catch covers the window between that read and the
   * insert. The index guarantees integrity; the check explains it.
   */
  async createBay(
    user: UserAccountToken,
    input: { slug: string; label?: string },
  ): Promise<{ estate: Estate; secret: string }> {
    const slug = await this.claimSlug(user.id, input.slug);
    const minted = this.tokens.mint();
    try {
      const estate = await this.estates.create({
        ownerUserId: user.id,
        type: "bay",
        slug,
        label: input.label?.trim() || undefined,
        secretHash: minted.hash,
        secretPrefix: minted.prefix,
      });

      // An estate is a credential, so its whole life is audited and kept
      // longer than the rest, see `LoreAudits`.
      await this.audits.estate.logSuccess("create", {
        ...this.audits.actor(user),
        resourceType: "estate",
        resourceId: estate.id,
        description: estate.slug,
      });

      return { estate, secret: minted.secret };
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(await this.explainConflict(user.id, slug));
      }
      throw error;
    }
  }

  /**
   * Creates a `cloudflare` estate from a token its owner pasted, after
   * proving that token against the account it names.
   *
   * ⚠️ **The check runs before the insert, and a failure leaves no row**
   * (owner's ruling, 2026-09-06: "add estate, Cloudflare, paste the token,
   * checking, OK"). There is no create-then-set path and no half-made
   * estate, which is what lets `credentialStatus` have two values instead of
   * three: a cloudflare estate that exists has passed at least once, and
   * `credentialCheckedAt` is written in the same insert.
   *
   * It mints nothing. `createBay` hands back the one cleartext copy of a
   * secret Lore generated; here the owner already holds the token, so the
   * response carries no `secret` at all and the UI must not open its
   * reveal dialog (#1865).
   *
   * `deployAllowed` is **true** at creation, unlike bay. A fresh machine is
   * stats-only until its owner says otherwise; a Cloudflare account has no
   * stats phase and exists to be deployed to, and the lending is what gates
   * who may use it. The switch stays as the owner's kill switch.
   */
  async createCloudflare(
    user: UserAccountToken,
    input: { slug: string; label?: string; accountId: string; token: string },
  ): Promise<{ estate: Estate }> {
    const slug = await this.claimSlug(user.id, input.slug);
    const check = await this.assertCredential(input);

    try {
      const estate = await this.estates.create({
        ownerUserId: user.id,
        type: "cloudflare",
        slug,
        label: input.label?.trim() || undefined,
        accountId: input.accountId,
        secretPrefix: this.cloudflare.mask(input.token),
        credential: this.seal.seal(
          input.token,
          CredentialSealService.ESTATE_PURPOSE,
        ),
        credentialKeyVersion: CredentialSealService.KEY_VERSION,
        credentialCheckedAt: this.dateTime.now().toISOString(),
        credentialExpiresAt: check.expiresAt,
        // A Cloudflare account is a deploy destination and nothing else.
        deployAllowed: true,
      });

      await this.audits.estate.logSuccess("create", {
        ...this.audits.actor(user),
        resourceType: "estate",
        resourceId: estate.id,
        description: estate.slug,
      });

      return { estate };
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(await this.explainConflict(user.id, slug));
      }
      throw error;
    }
  }

  /**
   * Replaces the token on a cloudflare estate, all or nothing.
   *
   * ⚠️ **A failed check leaves the row exactly as it was**: the old
   * credential stays sealed, the check fields are not cleared, and the
   * failure is the response rather than the row. The token the owner already
   * had keeps working, which is the whole point of checking before writing.
   *
   * Write-only, and audited as `rotate`: no GET returns the token and no
   * PATCH carries it, so replacing is never a read-modify-write through the
   * client. The UI says "Replace token"; the Activity filter does not grow a
   * verb for it.
   */
  async replaceCredential(
    user: UserAccountToken,
    estate: Estate,
    token: string,
  ): Promise<Estate> {
    if (estate.type !== "cloudflare") {
      throw new BadRequestError(
        "Only a cloudflare estate holds a token you pasted; a bay secret is rotated, not replaced",
      );
    }
    if (!estate.accountId) {
      throw new BadRequestError(
        "This estate has no Cloudflare account id to check a token against",
      );
    }

    const check = await this.assertCredential({
      accountId: estate.accountId,
      token,
    });

    await this.estates.updateById(estate.id, {
      secretPrefix: this.cloudflare.mask(token),
      credential: this.seal.seal(token, CredentialSealService.ESTATE_PURPOSE),
      credentialKeyVersion: CredentialSealService.KEY_VERSION,
      credentialCheckedAt: this.dateTime.now().toISOString(),
      credentialError: null,
      credentialExpiresAt: check.expiresAt ?? null,
    });

    // The same verb and the same severity as a bay rotation: "when was this
    // credential last changed" is the question asked after a leak is found,
    // and it is one question whichever kind of credential it was.
    await this.audits.estate.logSuccess("rotate", {
      ...this.audits.actor(user),
      severity: "warning",
      resourceType: "estate",
      resourceId: estate.id,
      description: estate.slug,
    });

    return this.estates.getOne({ where: { id: { eq: estate.id } } });
  }

  /**
   * Runs the credential check and turns anything but a pass into a refusal.
   *
   * A `failed` and an `inconclusive` both refuse the save, and what differs
   * is the sentence the caller reads: one names what Cloudflare refused and
   * is the owner's to fix, the other says Cloudflare could not be reached
   * and to try again. Both are written by the probe (#1630), so this only
   * has to not flatten them.
   *
   * ⚠️ Neither writes anything. On a create there is no row yet; on a
   * replace the row is left exactly as it was, which is what "all or
   * nothing" means: writing "invalid" for an unreachable Cloudflare would be
   * a lie that outlives the outage.
   */
  protected async assertCredential(input: {
    accountId: string;
    token: string;
  }): Promise<{ expiresAt?: string }> {
    const check = await this.cloudflare.check(input);
    if (check.outcome === "failed") {
      // `data` survives the round trip (`HttpError.toJSON`, read back by
      // `HttpClient` through `errorSchema`), which is what lets the dialog
      // put the message beside the field it concerns rather than in a toast
      // that is gone before it has been read (#1865).
      throw new HttpError({
        status: 400,
        message: check.message,
        data: { field: check.field },
      });
    }
    if (check.outcome === "inconclusive") {
      throw new HttpError({ status: 400, message: check.message });
    }
    return { expiresAt: check.expiresAt };
  }

  /**
   * Normalises a slug, then checks it.
   *
   * Normalised BEFORE it is validated, like an app name: `estateSlugSchema`
   * carries the length only, so `"  OVH-1 "` reaches this as typed and
   * leaves as `ovh-1`. Lowercasing rather than refusing is deliberate, since
   * the case is not a distinction anyone means.
   */
  normalizeSlug(raw: string): string {
    const slug = raw.trim().toLowerCase();
    if (
      !slug ||
      slug.length > ESTATE_SLUG_MAX_LENGTH ||
      !ESTATE_SLUG_PATTERN.test(slug)
    ) {
      throw new BadRequestError(
        "An estate slug is lowercase letters, digits and hyphens, like ovh-1",
      );
    }
    return slug;
  }

  /**
   * Loads an estate the caller owns, or answers as if it did not exist.
   *
   * The owner filter is the whole access rule: a non-owner gets the same 404
   * an unknown id gets, so nothing about another user's estates can be
   * learned by guessing ids. There is no per-estate role to check beyond
   * this; the project is the permission boundary, not the estate.
   */
  async loadOwned(estateId: string, user: UserAccountToken): Promise<Estate> {
    const estate = await this.estates.findOne({
      where: { id: { eq: estateId }, ownerUserId: { eq: user.id } },
    });
    if (!estate) {
      throw new NotFoundError("Estate not found");
    }
    return estate;
  }

  /**
   * Refuses to delete an estate, or detach it from a project, while an app
   * instance points at it.
   *
   * The rule, from folio #1194: never cascade. Cascading silently breaks other
   * people's projects, while refusing forces a visible repoint or removal in
   * each one. That is why `app_instances.estateId` is `set null` at the
   * database and this check exists above it: the constraint is there for an
   * account deletion, the refusal is there for everything else.
   *
   * With a `projectId` the question is narrower: only that project's instances
   * block a detach. Without one, any instance anywhere blocks a delete.
   *
   * The message names the instances (`club/production, club/staging`) rather
   * than counting them, because the operator's next action is to open each one
   * and repoint it. Capped so a project with fifty instances does not answer
   * with a paragraph.
   *
   * The one deliberate exception is a user account deletion, which cascades
   * through `estates.ownerUserId` without passing here: account deletion
   * must not be blockable by other people's projects.
   */
  async assertUnreferenced(
    estateId: string,
    projectId?: number,
  ): Promise<void> {
    const referencing = await this.instances.findMany({
      where: {
        estateId: { eq: estateId },
        ...(projectId === undefined ? {} : { projectId: { eq: projectId } }),
      },
      columns: ["app", "env"],
      orderBy: [
        { column: "app", direction: "asc" },
        { column: "env", direction: "asc" },
      ],
    });
    if (referencing.length === 0) {
      return;
    }

    const named = referencing
      .slice(0, this.referenceNameLimit)
      .map((instance) => `${instance.app}/${instance.env}`)
      .join(", ");
    const rest = referencing.length - this.referenceNameLimit;
    throw new ConflictError(
      `This estate is still the deploy target of ${named}${
        rest > 0 ? ` and ${rest} more` : ""
      }. Repoint or remove ${referencing.length === 1 ? "it" : "them"} first.`,
    );
  }

  /**
   * What an account deletion takes with it, for the confirmation dialog:
   * the estates the account owns, and how many projects lose a deploy
   * destination when they go.
   */
  /**
   * The owner's list with the projects each estate is lent to (#1838).
   *
   * Two queries for the whole list, never one per row. A project deleted
   * since the loan is left out by the repository's own soft-delete filter,
   * and its grant is left alone: the row cascades when the project is
   * really gone, and until then the loan is not the owner's to see.
   */
  async withLoans(owned: Estate[]): Promise<OwnedEstateResource[]> {
    if (owned.length === 0) {
      return [];
    }
    const estateIds = owned.map((estate) => estate.id);
    const grants = await this.grants.findMany({
      where: { estateId: { inArray: estateIds } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
    // One more query for the whole list, never one per row: the denormalised
    // `appCount` exists so this costs no JSON parsing either.
    const summaries = await this.inventories.summariesFor(estateIds);
    const projectIds = [...new Set(grants.map((grant) => grant.projectId))];
    const rows = projectIds.length
      ? await this.projects.findMany({
          where: { id: { inArray: projectIds } },
          columns: ["id", "title", "slug"],
        })
      : [];
    const named = new Map(rows.map((project) => [project.id, project]));

    return owned.map((estate) => ({
      ...this.toResource(estate),
      ...(summaries.has(estate.id)
        ? { inventory: summaries.get(estate.id) }
        : {}),
      projects: grants
        .filter((grant) => grant.estateId === estate.id)
        .flatMap((grant) => {
          const project = named.get(grant.projectId);
          return project
            ? [
                {
                  id: project.id,
                  title: project.title,
                  ...(project.slug ? { slug: project.slug } : {}),
                  lentAt: String(grant.createdAt),
                },
              ]
            : [];
        }),
    }));
  }

  async countOwned(
    userId: string,
  ): Promise<{ estates: number; projects: number }> {
    const owned = await this.estates.findMany({
      where: { ownerUserId: { eq: userId } },
    });
    if (owned.length === 0) {
      return { estates: 0, projects: 0 };
    }
    const grants = await this.grants.findMany({
      where: { estateId: { inArray: owned.map((estate) => estate.id) } },
    });
    return {
      estates: owned.length,
      projects: new Set(grants.map((grant) => grant.projectId)).size,
    };
  }

  /**
   * Normalises a slug and proves it is free for this owner.
   */
  protected async claimSlug(ownerUserId: string, raw: string): Promise<string> {
    const slug = this.normalizeSlug(raw);
    const clash = await this.estates.findOne({
      where: { ownerUserId: { eq: ownerUserId }, slug: { eq: slug } },
    });
    if (clash) {
      throw new ConflictError(`You already have an estate named "${slug}"`);
    }
    return slug;
  }

  /**
   * Works out which unique index refused the insert, and says so.
   *
   * `estates` carries two: `(ownerUserId, slug)` and `secretHash`. The first
   * says "you already have this estate", the second says "try again and you
   * will get a different secret", and answering the first to the second case
   * would send an owner looking for an estate that does not exist.
   */
  protected async explainConflict(
    ownerUserId: string,
    slug: string,
  ): Promise<string> {
    const clash = await this.estates.findOne({
      where: { ownerUserId: { eq: ownerUserId }, slug: { eq: slug } },
    });
    return clash
      ? `You already have an estate named "${slug}"`
      : "Could not mint a unique secret for this estate, retry.";
  }
}
