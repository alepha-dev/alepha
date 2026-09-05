import { $repository, DbConflictError } from "alepha/orm";
import { BadRequestError, ConflictError, NotFoundError } from "alepha/server";

import { type AppInstance, appInstances } from "../entities/appInstances.ts";
import { estateProjects } from "../entities/estateProjects.ts";
import { sigils } from "../entities/sigils.ts";
import {
  APP_NAME_PATTERN,
  SIGIL_NAME_PAIR_MAX_LENGTH,
} from "../schemas/appNameSchema.ts";
import { defaultAppInstance } from "../schemas/defaultAppInstance.ts";

/**
 * What an app instance IS, stated once: how its two names are normalised, what
 * makes the pair unique, which estate it may point at, and what deleting one
 * takes with it.
 *
 * Every write to `app_instances` goes through here, and so does every write to
 * `sigils.name`, which is a mirror of this table (see {@link mirrorName}).
 * `AppController` (#1768) is the HTTP door; the rules are here so the MCP shim
 * (#1778) and the create dialog cannot disagree with it.
 *
 * Auth is deliberately NOT enforced here, following `AreaService`: every caller
 * has already run `ProjectSecurityService.assertOwner` or `assertMember`, and a
 * service that re-checked would need a token it has no business holding. The
 * one exception is {@link setEstate}'s lending check, which is not
 * authorization of the caller but validation of the reference itself.
 */
export class AppService {
  protected readonly instances = $repository(appInstances);
  protected readonly sigils = $repository(sigils);
  protected readonly grants = $repository(estateProjects);

  /**
   * Normalises one half of the pair, then checks it.
   *
   * Normalised BEFORE it is validated, exactly as `SigilController.claimName`
   * does, and for the same two reasons: `appNameSchema` carries the length only
   * (a pattern folded into the schema would refuse `Lore-Staging` outright
   * instead of normalising it), and the case is not a distinction anyone means
   * in a URL segment.
   *
   * `label` names which half, because "an app name" and "an environment name"
   * are two fields on one dialog and a message that named neither would leave
   * an operator guessing which one it meant.
   */
  normalize(raw: string, label: "app" | "environment"): string {
    const value = raw.trim().toLowerCase();
    if (!APP_NAME_PATTERN.test(value)) {
      throw new BadRequestError(
        `An ${label} name may only contain lowercase letters, digits and hyphens, and must start and end with a letter or digit`,
      );
    }
    return value;
  }

  /**
   * Refuses a pair too long to mirror onto `sigils.name`.
   *
   * ⚠️ Load-bearing, and the failure it prevents is not a bad request. Both
   * halves are `max(64)` on the way in, so an unchecked pair reaches 129
   * characters against a column validated at `max(100)` **on read** - and a row
   * that fails its column's schema does not read as `undefined`, it throws
   * every query that touches the table. That is the `projects.features`
   * incident of 2026-08-05 from the same direction, and it would land on
   * `sigils`, which the blights inbox and the insights page both read.
   *
   * Checked on create and on every rename, whether or not the instance has a
   * sigil today: one may be minted tomorrow and the pair would already be
   * illegal.
   */
  assertPairFits(app: string, env: string): void {
    if (app.length + env.length > SIGIL_NAME_PAIR_MAX_LENGTH) {
      throw new BadRequestError(
        `An app and environment name may not exceed ${SIGIL_NAME_PAIR_MAX_LENGTH} characters together`,
      );
    }
  }

  /**
   * What `sigils.name` holds once a sigil belongs to an instance.
   *
   * The column cannot be left alone: it is `NOT NULL`, unique on
   * `(projectId, name)`, and read as a display label by
   * `BlightController.listBlights`, `InsightsController.labels`,
   * `DashboardMetricRegistry.scopeNames`, `LoreAudits` and MCP `sigil_list`.
   * Two instances of `club` with two sigils cannot both be named `club`.
   *
   * `/` is outside `APP_NAME_PATTERN`, so a mirror can never collide with a
   * pre-v3 name, and `(app, env)` is unique, so the mirror satisfies the
   * existing index for free. Every reader keeps working with zero joins and
   * shows the instance, which is what a label should show now.
   *
   * Rejected: dropping the unique index and keeping `name = app`, which gives
   * three identical labels for three instances; and joining `app_instances` in
   * the four readers, which is four places to get a label wrong.
   */
  mirrorName(app: string, env: string): string {
    return `${app}/${env}`;
  }

  /**
   * The instance a bare `/apps/:app` means, and the one the `sigil_create` shim
   * mints into.
   *
   * The rule itself is `defaultAppInstance`, which the `/apps/:app` redirect
   * also reads: that one runs in the browser and cannot inject this service, so
   * the rule lives in a module both can import rather than being stated twice.
   * This method is the server-side door onto it, and nothing more.
   */
  async defaultInstance(
    projectId: number,
    app: string,
  ): Promise<AppInstance | undefined> {
    const rows = await this.instances.findMany({
      where: { projectId: { eq: projectId }, app: { eq: app } },
    });
    return defaultAppInstance(rows, app);
  }

  /**
   * Loads one instance by its pair, or answers 404.
   *
   * The project filter is the cross-project guard, the same one `loadSigil`
   * carries: without it a pair from another project would resolve and the
   * caller's owner check would have passed on the wrong project.
   */
  async load(
    projectId: number,
    app: string,
    env: string,
  ): Promise<AppInstance> {
    const instance = await this.instances.findOne({
      where: {
        projectId: { eq: projectId },
        app: { eq: app },
        env: { eq: env },
      },
    });
    if (!instance) {
      throw new NotFoundError("App not found");
    }
    return instance;
  }

  /**
   * Creates an instance, and mints nothing.
   *
   * That is the point of the epic: you type two names and get a deploy target.
   * A sigil is an unlock added afterwards from the instance's own Settings
   * (#1769), never a side effect of naming an app.
   *
   * The duplicate is refused twice, the shape `createSigil` uses: the `findOne`
   * names the clash in a message an operator reads, and the `DbConflictError`
   * catch covers the window between that read and the insert. The unique index
   * is what guarantees integrity; the check only explains it.
   */
  async create(input: {
    projectId: number;
    app: string;
    env: string;
    url?: string;
    createdBy?: string;
  }): Promise<AppInstance> {
    const app = this.normalize(input.app, "app");
    const env = this.normalize(input.env, "environment");
    this.assertPairFits(app, env);
    const url = input.url === undefined ? null : this.readUrl(input.url);

    const clash = await this.instances.findOne({
      where: {
        projectId: { eq: input.projectId },
        app: { eq: app },
        env: { eq: env },
      },
    });
    if (clash) {
      throw new ConflictError(`"${app}/${env}" already exists`);
    }

    try {
      return await this.instances.create({
        projectId: input.projectId,
        app,
        env,
        ...(url ? { url } : {}),
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      });
    } catch (error) {
      if (error instanceof DbConflictError) {
        throw new ConflictError(`"${app}/${env}" already exists`);
      }
      throw error;
    }
  }

  /**
   * Renames either half, and carries the `sigils.name` mirror with it.
   *
   * One method for both halves because they are one uniqueness rule and one
   * mirror: renaming them in two calls would leave a window where the pair is
   * `club/staging` in this table and `club/production` in `sigils`, and nothing
   * would ever repair it.
   *
   * An omitted half means "leave it alone", the shape every update body in this
   * codebase has. Renaming to the pair it already holds is a no-op rather than
   * a collision with itself.
   */
  async rename(
    instance: AppInstance,
    input: { app?: string; env?: string },
  ): Promise<AppInstance> {
    const app =
      input.app === undefined ? instance.app : this.normalize(input.app, "app");
    const env =
      input.env === undefined
        ? instance.env
        : this.normalize(input.env, "environment");

    if (app === instance.app && env === instance.env) {
      return instance;
    }
    this.assertPairFits(app, env);

    const clash = await this.instances.findOne({
      where: {
        projectId: { eq: instance.projectId },
        app: { eq: app },
        env: { eq: env },
      },
    });
    if (clash && clash.id !== instance.id) {
      throw new ConflictError(`"${app}/${env}" already exists`);
    }

    await this.instances.updateById(instance.id, { app, env });

    // The mirror, in the same method for the reason above. Nothing else writes
    // this column: `updateSigil` lost its `name` field when this landed.
    if (instance.sigilId) {
      await this.sigils.updateById(instance.sigilId, {
        name: this.mirrorName(app, env),
      });
    }

    return { ...instance, app, env };
  }

  /**
   * Points this instance at an estate the project has been LENT, or clears it.
   *
   * ⚠️ Validated against `estate_projects` and never against `estates`. An
   * estate is owned by a user and lent to a project (folio #1194); resolving
   * the id against the estates table directly would let a project point at an
   * estate it was never given, which is folio #96's `targetId` hole wearing a
   * foreign key. The 404 rather than a 403 is deliberate too: a project that
   * was never lent an estate should not be able to learn that it exists.
   *
   * This is the one write path for the column, which is what lets epic #1's
   * deploy resolve the estate server-side from the row. A client that could
   * name its own estate at deploy time could deploy into somebody else's cloud
   * account.
   */
  async setEstate(
    instance: AppInstance,
    estateId: string | null,
  ): Promise<AppInstance> {
    if (estateId === null) {
      await this.instances.updateById(instance.id, { estateId: null });
      return { ...instance, estateId: undefined };
    }

    const grant = await this.grants.findOne({
      where: {
        estateId: { eq: estateId },
        projectId: { eq: instance.projectId },
      },
    });
    if (!grant) {
      throw new NotFoundError("This project has no such estate");
    }

    await this.instances.updateById(instance.id, { estateId });
    return { ...instance, estateId };
  }

  /**
   * Pins the address of this copy, or clears it.
   *
   * The empty string is the way to clear it, and it has to be: every other
   * field here is a choice among values, this one is free text whose absence is
   * meaningful. With omission as the only "no", an operator who pinned the
   * wrong address could never get back to the detected one.
   */
  async setUrl(instance: AppInstance, raw: string): Promise<AppInstance> {
    const url = this.readUrl(raw);
    await this.instances.updateById(instance.id, { url });
    return { ...instance, url: url ?? undefined };
  }

  /**
   * Reads the operator's app URL, or refuses it.
   *
   * `null` for blank, which is what clears the override and hands the answer
   * back to the host the app reports from.
   *
   * Only `http` and `https` are accepted, and that is the whole point of
   * parsing rather than storing the string: this value becomes an `href` on a
   * page a project's members read, so `javascript:` - which `new URL()` parses
   * perfectly happily - has to be refused here rather than escaped there.
   * Relative input is refused too: a link that resolves against Lore's own
   * origin points at Lore, which is never what the operator meant.
   *
   * Moved here from `SigilController` with the column it validates: the address
   * belongs to the instance now, and `updateSigil` lost both.
   */
  readUrl(raw: string): string | null {
    const value = raw.trim();
    if (!value) {
      return null;
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestError(
        "An app URL must be absolute, like https://example.com",
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new BadRequestError("An app URL must be http or https");
    }

    // A bare origin keeps no trailing slash: `https://example.com/` and
    // `https://example.com` are the same address, and only one of them should
    // ever be shown.
    return parsed.pathname === "/" && !parsed.search && !parsed.hash
      ? parsed.origin
      : parsed.href;
  }

  /**
   * Removes an instance, and the sigil it holds.
   *
   * Enforced here rather than by a database rule, the way `ArtifactService`
   * enforces `fileId`: the foreign key is `set null` in the other direction
   * (deleting a credential must not delete a deploy target), so the cascade
   * this direction wants cannot be expressed as a constraint.
   *
   * ⚠️ Deleting the sigil takes that app's views, uniques, vitals and error
   * groups with it - all four tables cascade on `sigilId`. That is the cost the
   * confirmation dialog spells out, and it is why rotating exists.
   *
   * **Deleting an instance undeploys nothing.** It removes Lore's record of a
   * deployed copy, not the copy.
   */
  async delete(instance: AppInstance): Promise<void> {
    await this.instances.deleteById(instance.id);
    if (instance.sigilId) {
      await this.sigils.deleteById(instance.sigilId);
    }
  }
}
