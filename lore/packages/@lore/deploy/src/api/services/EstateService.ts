import {
  LoreAudits,
  ProjectPermissions,
  ProjectSecurityService,
} from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { displayName } from "@lore/core/web";
import { $inject } from "alepha";
import { organizationMembers, RankService } from "alepha/api/organizations";
import { users } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbConflictError } from "alepha/orm";
import type { UserAccountToken } from "alepha/security";
import { BadRequestError, ConflictError, HttpError } from "alepha/server";

import { appInstances } from "../entities/appInstances.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { type Estate, type EstateType, estates } from "../entities/estates.ts";
import { stackEnvironments } from "../entities/stackEnvironments.ts";
import { stacks } from "../entities/stacks.ts";
import { EstateCredentialRefused } from "../errors/EstateCredentialRefused.ts";
import { acceptedRuntimes } from "../schemas/acceptedRuntimes.ts";
import {
  type EstateResource,
  estateResourceSchema,
} from "../schemas/estateResourceSchema.ts";
import {
  ESTATE_SLUG_MAX_LENGTH,
  ESTATE_SLUG_PATTERN,
} from "../schemas/estateSlugSchema.ts";
import {
  ESTATE_FEATURES,
  ESTATE_PROTOCOL_VERSION,
  type EstateWelcomeFrame,
} from "../schemas/estateWelcomeFrameSchema.ts";
import type { OwnedEstateResource } from "../schemas/ownedEstateResourceSchema.ts";
import { CredentialSealService } from "./CredentialSealService.ts";
import { EstateCloudflareService } from "./EstateCloudflareService.ts";
import { EstateInventoryService } from "./EstateInventoryService.ts";
import { EstateTokenService } from "./EstateTokenService.ts";

/**
 * What an estate IS, stated once: which runtimes its type runs, when it
 * counts as online, what may be read off it, how one is minted, and what
 * stands in the way of deleting it.
 *
 * The rules here are the ones folio #1194 fixed on 2026-09-04, as epic #E126
 * changed them: an estate belongs to its home project, and who may act on it
 * is a rank there. The estate controller, the project-side lending (#1837),
 * the admin backstop (#1838) and the app instances that point at an estate
 * (#1767) all read them from here rather than restating them. Access itself
 * is not here: every estate action goes through `$ownsProject` on the row.
 */
export class EstateService {
  protected readonly estates = $repository(estates);
  protected readonly instances = $repository(appInstances);
  protected readonly grants = $repository(estateProjects);
  protected readonly stacks = $repository(stacks);
  protected readonly stackEnvironments = $repository(stackEnvironments);
  protected readonly projects = $repository(projects);
  protected readonly members = $repository(organizationMembers);
  protected readonly users = $repository(users);
  protected readonly projectSecurity = $inject(ProjectSecurityService);
  protected readonly permissions = $inject(ProjectPermissions);
  protected readonly ranks = $inject(RankService);
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
    // Delegated rather than inlined: the Deploy tab needs the same answer and
    // a browser cannot inject a service, so the mapping lives in a module both
    // sides read. See `schemas/acceptedRuntimes.ts`.
    return acceptedRuntimes(type);
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
  /**
   * Whether a throwaway estate is past the expiry its TTL set (#Q3138).
   */
  isOverdue(estate: Estate, now = this.dateTime.nowMillis()): boolean {
    return !!estate.expiresAt && Date.parse(estate.expiresAt) <= now;
  }

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
      features: [...ESTATE_FEATURES],
    };
  }

  /**
   * Projects a row into what a member of its home project may see. The home
   * project and the caller's `can` are added by {@link present}.
   *
   * No credential crosses, of either kind: `estateResourceSchema` is a
   * `pick` allowlist and parsing strips everything outside it, so a column
   * added to the row reaches a browser only when somebody adds a line there
   * on purpose (#1629).
   */
  toResource(estate: Estate): EstateResource {
    return estateResourceSchema.parse({
      can: [],
      ...estate,
      online: this.isOnline(estate),
      overdue: this.isOverdue(estate),
      acceptedRuntimes: this.acceptedRuntimes(estate.type),
      credentialStatus: this.cloudflare.credentialStatus(estate),
    });
  }

  /**
   * Mints a `bay` estate in its home project, and hands back the only
   * cleartext copy of its secret that will ever exist.
   *
   * One path for every entry point (the project's Settings, `lore estate
   * add`, `lore estate provision`), so they cannot disagree about
   * normalisation, uniqueness or the audit row. `(projectId, slug)` is
   * unique: the `findOne` in {@link claimSlug} names the clash in a message
   * the caller reads, and the `DbConflictError` catch covers the window
   * between that read and the insert. The index guarantees integrity; the
   * check explains it.
   *
   * `ownerUserId` is the cascade anchor, the home project's owner, and
   * `createdBy` the caller (#Q3278).
   */
  async createBay(
    user: UserAccountToken,
    projectId: number,
    input: { slug: string; label?: string },
  ): Promise<{ estate: Estate; secret: string }> {
    const slug = await this.claimSlug(projectId, input.slug);
    const anchor = await this.anchorOf(projectId);
    const minted = await this.tokens.mint();
    try {
      const estate = await this.estates.create({
        ownerUserId: anchor,
        projectId,
        createdBy: user.id,
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
        ...this.audits.scope(projectId),
        resourceType: "estate",
        resourceId: estate.id,
        description: estate.slug,
      });

      return { estate, secret: minted.secret };
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(await this.explainConflict(projectId, slug));
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
    projectId: number,
    input: { slug: string; label?: string; accountId: string; token: string },
  ): Promise<{ estate: Estate }> {
    const slug = await this.claimSlug(projectId, input.slug);
    const anchor = await this.anchorOf(projectId);
    const check = await this.assertCredential(input);

    try {
      const estate = await this.estates.create({
        ownerUserId: anchor,
        projectId,
        createdBy: user.id,
        type: "cloudflare",
        slug,
        label: input.label?.trim() || undefined,
        accountId: input.accountId,
        secretPrefix: this.cloudflare.mask(input.token),
        credential: await this.seal.seal(
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
        ...this.audits.scope(projectId),
        resourceType: "estate",
        resourceId: estate.id,
        description: estate.slug,
      });

      return { estate };
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(await this.explainConflict(projectId, slug));
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
      credential: await this.seal.seal(
        token,
        CredentialSealService.ESTATE_PURPOSE,
      ),
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
      // `data.field` survives the round trip, which is what lets the dialog
      // put the message beside the field it concerns (#1865).
      throw new EstateCredentialRefused(
        { field: check.field },
        { message: check.message },
      );
    }
    if (check.outcome === "inconclusive") {
      throw new HttpError({ status: 400 }, { message: check.message });
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
   * Refuses to delete an estate, or detach it from a project, while an app
   * instance, a stack or a stack environment points at it.
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
   * The message names the instances (`acme/production, acme/staging`) rather
   * than counting them, because the operator's next action is to open each one
   * and repoint it. Capped so a project with fifty instances does not answer
   * with a paragraph.
   *
   * The one deliberate exception is the deletion of the account an estate
   * with no home is anchored on, which cascades through `estates.ownerUserId`
   * without passing here: account deletion must not be blockable by other
   * people's projects. A homed estate's anchor is its project's owner, who
   * cannot delete their account while they own it.
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
      columns: ["app", "env", "projectId"],
      orderBy: [
        { column: "app", direction: "asc" },
        { column: "env", direction: "asc" },
      ],
    });
    // A deleted project deploys nothing (#Q3169): its copies do not hold the
    // estate, even those left from before its deletion freed them.
    const live = await this.liveProjects(
      referencing.map((instance) => instance.projectId),
    );
    const named = [
      ...referencing
        .filter((instance) => live.has(instance.projectId))
        .map((instance) => `${instance.app}/${instance.env}`),
      ...(await this.stacksReferencing(estateId, projectId)),
    ];
    if (named.length === 0) {
      return;
    }

    const rest = named.length - this.referenceNameLimit;
    throw new ConflictError(
      `This estate is still the deploy target of ${named
        .slice(0, this.referenceNameLimit)
        .join(", ")}${
        rest > 0 ? ` and ${rest} more` : ""
      }. Repoint or remove ${named.length === 1 ? "it" : "them"} first.`,
    );
  }

  /**
   * Which of these projects still exist: the repository leaves out a
   * soft-deleted row, so a project its owner deleted is not among them.
   */
  protected async liveProjects(ids: number[]): Promise<Set<number>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return new Set();
    }
    const rows = await this.projects.findMany({
      where: { id: { inArray: unique } },
      columns: ["id"],
    });
    return new Set(rows.map((row) => row.id));
  }

  /**
   * The stacks and stack environments that deploy to an estate, named as
   * `stack (stack)` for a stack's default estate and `stack/env (stack)` for
   * an environment's own override (#Q3131).
   *
   * Both columns are `set null` at the database for the reason
   * `app_instances.estateId` is: without this, deleting an estate silently
   * left a stack with nowhere to deploy. With a `projectId`, only that
   * project's stacks count, as for instances.
   */
  protected async stacksReferencing(
    estateId: string,
    projectId?: number,
  ): Promise<string[]> {
    const scope =
      projectId === undefined ? {} : { projectId: { eq: projectId } };
    const allDefaults = await this.stacks.findMany({
      where: { estateId: { eq: estateId }, ...scope },
      columns: ["name", "projectId"],
      orderBy: [{ column: "name", direction: "asc" }],
    });
    const liveDefaults = await this.liveProjects(
      allDefaults.map((stack) => stack.projectId),
    );
    const defaults = allDefaults.filter((stack) =>
      liveDefaults.has(stack.projectId),
    );
    const overrides = await this.stackEnvironments.findMany({
      where: { estateId: { eq: estateId } },
      columns: ["stackId", "env"],
      orderBy: [{ column: "env", direction: "asc" }],
    });
    const owners = overrides.length
      ? await this.stacks.findMany({
          where: {
            id: { inArray: [...new Set(overrides.map((row) => row.stackId))] },
            ...scope,
          },
          columns: ["id", "name", "projectId"],
        })
      : [];
    const liveOwners = await this.liveProjects(
      owners.map((stack) => stack.projectId),
    );
    const nameOf = new Map(
      owners
        .filter((stack) => liveOwners.has(stack.projectId))
        .map((stack) => [stack.id, stack.name]),
    );
    return [
      ...defaults.map((stack) => `${stack.name} (stack)`),
      ...overrides
        .filter((row) => nameOf.has(row.stackId))
        .map((row) => `${nameOf.get(row.stackId)}/${row.env} (stack)`)
        .sort(),
    ];
  }

  /**
   * The list with the projects each estate is lent to (#1838), its home
   * project, who added it, and what the caller may do with it.
   *
   * A few queries for the whole list, never one per row. A project deleted
   * since the loan is left out by the repository's own soft-delete filter,
   * and its grant is left alone: the row cascades when the project is
   * really gone.
   */
  async withLoans(
    owned: Estate[],
    user: UserAccountToken,
  ): Promise<OwnedEstateResource[]> {
    if (owned.length === 0) {
      return [];
    }
    const presented = await this.present(owned, user);
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

    return owned.map((estate, index) => ({
      ...presented[index]!,
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

  /**
   * What an account deletion takes with it, for the confirmation dialog: the
   * estates with no home anchored on the account, which go with it, and how
   * many projects lose a deploy destination when they go. A homed estate
   * outlives the account, so it is not counted.
   */
  async countOwned(
    userId: string,
  ): Promise<{ estates: number; projects: number }> {
    const owned = await this.estates.findMany({
      where: { ownerUserId: { eq: userId }, projectId: { isNull: true } },
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
   * Normalises a slug and proves it is free in this home project.
   */
  async claimSlug(projectId: number, raw: string): Promise<string> {
    const slug = this.normalizeSlug(raw);
    const clash = await this.estates.findOne({
      where: { projectId: { eq: projectId }, slug: { eq: slug } },
    });
    if (clash) {
      throw new ConflictError(await this.slugTaken(projectId, slug));
    }
    return slug;
  }

  protected async slugTaken(projectId: number, slug: string): Promise<string> {
    const project = await this.projects.findById(projectId);
    return `${project?.title ?? "This project"} already has an estate named "${slug}"`;
  }

  /**
   * Works out which unique index refused the insert, and says so.
   *
   * `estates` carries two: `(projectId, slug)` and `secretHash`. The first
   * says "the project already has this estate", the second says "try again
   * and you will get a different secret", and answering the first to the
   * second case would send somebody looking for an estate that does not
   * exist.
   */
  protected async explainConflict(
    projectId: number,
    slug: string,
  ): Promise<string> {
    const clash = await this.estates.findOne({
      where: { projectId: { eq: projectId }, slug: { eq: slug } },
    });
    return clash
      ? this.slugTaken(projectId, slug)
      : "Could not mint a unique secret for this estate, retry.";
  }

  /**
   * Give an estate a new home project, for a move by its managers or an
   * assign by the instance admin (#Q3280). The caller has gated who may;
   * this holds what must be true of the target and of the row.
   *
   * - The target must have Apps on, or the estate could be managed through
   *   no page there.
   * - `(projectId, slug)` is unique, and the slug is never rewritten: a
   *   machine's config may record it. A collision is refused.
   * - Loans, the secret, the credential, the command queue, the inventory
   *   and the stats series stay on the row: the machine notices nothing.
   * - `projectId` and the `ownerUserId` anchor change in ONE statement whose
   *   WHERE names the home being left, so there is no half-moved state and
   *   two movers cannot both win.
   */
  async rehome(
    estate: Estate,
    targetProjectId: number,
  ): Promise<{ estate: Estate; from?: number }> {
    if (estate.projectId === targetProjectId) {
      throw new BadRequestError("The estate is already in this project");
    }
    const target = await this.projects.findById(targetProjectId);
    if (!target) {
      throw new BadRequestError("No such project");
    }
    const capabilities =
      await this.projectSecurity.capabilitiesOf(targetProjectId);
    if (!("apps" in capabilities)) {
      throw new BadRequestError(
        `${target.title} does not have Apps on, so nobody could manage the estate there. Turn Apps on first.`,
      );
    }
    const clash = await this.estates.findOne({
      where: { projectId: { eq: targetProjectId }, slug: { eq: estate.slug } },
    });
    if (clash) {
      throw new ConflictError(
        `${target.title} already has an estate named "${estate.slug}", and a slug never changes`,
      );
    }
    const anchor = await this.anchorOf(targetProjectId);
    const moved = await this.estates.updateMany(
      {
        id: { eq: estate.id },
        projectId:
          estate.projectId == null
            ? { isNull: true }
            : { eq: estate.projectId },
      },
      { projectId: targetProjectId, ownerUserId: anchor },
    );
    if (moved.length === 0) {
      throw new ConflictError(
        "The estate changed project meanwhile; read it again",
      );
    }
    return {
      estate: await this.estates.getById(estate.id),
      ...(estate.projectId == null ? {} : { from: estate.projectId }),
    };
  }

  /**
   * The projects an estate is lent to, oldest loan first, by name.
   */
  async loansOf(
    estateId: string,
  ): Promise<Array<{ id: number; title: string; slug?: string }>> {
    const grants = await this.grants.findMany({
      where: { estateId: { eq: estateId } },
      orderBy: [{ column: "createdAt", direction: "asc" }],
    });
    if (grants.length === 0) {
      return [];
    }
    const rows = await this.projects.findMany({
      where: { id: { inArray: grants.map((grant) => grant.projectId) } },
      columns: ["id", "title", "slug"],
    });
    return grants.flatMap((grant) => {
      const project = rows.find((row) => row.id === grant.projectId);
      return project
        ? [
            {
              id: project.id,
              title: project.title,
              ...(project.slug ? { slug: project.slug } : {}),
            },
          ]
        : [];
    });
  }

  /**
   * The user id of a project's owner: the cascade anchor of an estate homed
   * there (#Q3278). Refused for a project with no owner, which cannot hold
   * an estate that must outlive its creator.
   */
  async anchorOf(projectId: number): Promise<string> {
    const owner = await this.ownerOf(projectId);
    if (!owner) {
      throw new BadRequestError("This project has no owner to hold an estate");
    }
    return owner;
  }

  /**
   * The user id of a project's owner, or undefined for a project with none.
   */
  async ownerOf(projectId: number): Promise<string | undefined> {
    const project = await this.projects.findById(projectId);
    if (!project?.organizationId) return undefined;
    const owner = await this.members.findOne({
      where: {
        organizationId: { eq: project.organizationId },
        rank: { eq: "owner" },
      },
    });
    return owner?.userId;
  }

  /**
   * The caller's effective estate permissions in a project (application AND
   * rank AND capability), through `ProjectPermissions`, the one place that
   * computes them. Empty for somebody who is not a member.
   */
  async estatePermissionsIn(
    projectId: number,
    user: UserAccountToken,
  ): Promise<string[]> {
    const organizationId =
      await this.projectSecurity.organizationIdOf(projectId);
    const member = await this.members.findOne({
      where: {
        organizationId: { eq: organizationId },
        userId: { eq: user.id },
      },
    });
    if (!member && user.ownership !== false) {
      return [];
    }
    const { permissions } = await this.permissions.of(
      projectId,
      user,
      member ?? undefined,
    );
    return permissions.filter((permission) => permission.startsWith("estate:"));
  }

  /**
   * Rows as resources, each with its home project, who added it, and the
   * caller's `can` in that project. One read of the projects and one of the
   * creators for the whole list; the permissions are computed once per home
   * project.
   */
  async present(
    rows: Estate[],
    user: UserAccountToken,
  ): Promise<EstateResource[]> {
    const projectIds = [
      ...new Set(
        rows.flatMap((row) => (row.projectId == null ? [] : [row.projectId])),
      ),
    ];
    const creatorIds = [
      ...new Set(rows.flatMap((row) => (row.createdBy ? [row.createdBy] : []))),
    ];
    const [homes, creators] = await Promise.all([
      projectIds.length
        ? this.projects.findMany({
            where: { id: { inArray: projectIds } },
            columns: ["id", "title", "slug"],
          })
        : [],
      creatorIds.length
        ? this.users.findMany({ where: { id: { inArray: creatorIds } } })
        : [],
    ]);
    const can = new Map<number, string[]>();
    for (const projectId of projectIds) {
      can.set(projectId, await this.estatePermissionsIn(projectId, user));
    }
    return rows.map((row) => {
      const home = homes.find((project) => project.id === row.projectId);
      const creator = creators.find((it) => it.id === row.createdBy);
      return {
        ...this.toResource(row),
        ...(home
          ? {
              project: {
                id: home.id,
                title: home.title,
                ...(home.slug ? { slug: home.slug } : {}),
              },
            }
          : {}),
        ...(creator
          ? { creator: { id: creator.id, name: displayName(creator) } }
          : {}),
        can: row.projectId == null ? [] : (can.get(row.projectId) ?? []),
      };
    });
  }

  /**
   * The page a message about this estate links to, as a path from the app's
   * root: a `bay` estate's console under its home project, a `cloudflare`
   * one's row in that project's estates list (it has no console), and the
   * admin's estates page for an estate with no home, the only place it can be
   * opened. Estates have no account page since #E126.
   */
  async pagePath(estate: Estate): Promise<string> {
    const home =
      estate.projectId == null
        ? undefined
        : await this.projects.findById(estate.projectId);
    if (!home?.slug) {
      return "/admin/estates";
    }
    return estate.type === "bay"
      ? `/${home.slug}/estates/${estate.slug}`
      : `/${home.slug}/settings/estates`;
  }

  /**
   * Who is told when something about an estate needs fixing (a credential
   * failing, a server overdue): every member of its home project whose rank
   * grants `estate:update`, the owner always among them. An estate with no
   * home tells its anchor, the person who created it, until the admin
   * assigns it.
   */
  async recipientsOf(estate: Estate): Promise<string[]> {
    if (estate.projectId == null) {
      return [estate.ownerUserId];
    }
    const organizationId = await this.projectSecurity.organizationIdOf(
      estate.projectId,
    );
    return this.ranks.holdersOf(organizationId, "estate:update");
  }
}
