import { $inject, Alepha, type Infer } from "alepha";
import {
  type OrganizationMember,
  organizationMembers,
  organizations,
} from "alepha/api/organizations";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";

import { folioLinks } from "../api/entities/folioLinks.ts";
import { projectCapabilities } from "../api/entities/projectCapabilities.ts";
import { type Project, projects } from "../api/entities/projects.ts";
import type { CapabilityKey } from "../api/schemas/capabilityKeySchema.ts";
import { ProjectSecurityService } from "../api/services/ProjectSecurityService.ts";

type ProjectInsert = Infer<typeof projects.insertSchema>;

/**
 * Core's repository bag (#E75, #Q2611): the tables a project needs, and the
 * thing a spec constructs BEFORE `alepha.start()`.
 *
 * `$entity`'s `db.ref` foreign keys are resolved once, when the database is
 * synchronized at boot, and only against tables whose `Repository` has
 * already been constructed by then. A module's fixture extends this one with
 * its own tables, so the whole FK closure is registered up front.
 */
export class CoreTestEntities {
  /**
   * The bag each container constructed, whichever class it was: a module's
   * fixture extends this one, and a spec registers that subclass before
   * `start()`. Injecting `CoreTestEntities` itself after `start()` would be
   * refused, so the helpers below look the bag up here instead.
   */
  protected static readonly registered = new WeakMap<
    Alepha,
    CoreTestEntities
  >();

  public static of(alepha: Alepha): CoreTestEntities {
    return (
      CoreTestEntities.registered.get(alepha) ?? alepha.inject(CoreTestEntities)
    );
  }

  protected readonly alepha = $inject(Alepha);
  organizations = $repository(organizations);
  organizationMembers = $repository(organizationMembers);
  members = $repository(organizationMembers);
  projects = $repository(projects);
  users = $repository(users);
  folioLinks = $repository(folioLinks);
  // Needed pre-`start()` like the rest: `project_capabilities.projectId` refs
  // `projects`, and a fixture that writes one after `start()` without this
  // fails at BOOT with "Referenced table not found", nowhere near the call
  // that needed it.
  capabilities = $repository(projectCapabilities);

  constructor() {
    CoreTestEntities.registered.set(this.alepha, this);
  }
}

let projectSeq = 0;

/**
 * Creates a project directly through the repository, bypassing
 * `ProjectController` (auth, slug derivation, preset ranks). Fine for tests
 * that only need a valid `projectId` to hang other rows off.
 *
 * ⚠️ It DOES write the creator's membership row, with `rank: "owner"`.
 * `projects.createdBy` stopped being an authorization input in epic #E39, and
 * #Q1927's backfill gave every existing project's creator such a row - so a
 * fixture project without one is a shape production does not have, and every
 * gate would refuse its own creator.
 *
 * `createdBy` is a real `users` row, not a bare random uuid: `projects`
 * itself carries no FK on that column (see the comment on
 * `projects.createdBy`), but `quests.createdBy` — which `createTestQuest`
 * defaults to this project's owner — does, so an unbacked uuid here would
 * only fail later, at the quest insert, for a reason that has nothing to
 * do with the quest.
 */
export const createTestProject = async (
  alepha: Alepha,
  overrides: Partial<ProjectInsert> & {
    /**
     * Which capabilities the project has, and the options inside each.
     *
     * ⚠️ **Defaults to ALL FOUR, with every option on.** A fixture that
     * withheld one would make a spec about quest ordering fail for a reason
     * that has nothing to do with quest ordering, which is the kind of
     * failure that gets fixed by copying whatever the neighbouring spec does.
     * A spec whose SUBJECT is a capability being off says so explicitly, and
     * reads better for it.
     */
    capabilities?: Array<{
      key: CapabilityKey;
      options?: Record<string, boolean>;
    }>;
  } = {},
): Promise<Project> => {
  const repo = CoreTestEntities.of(alepha);
  const owner = await repo.users.create({});
  projectSeq += 1;
  const title = overrides.title ?? `Test Project ${projectSeq}`;
  const { capabilities, ...columns } = overrides;
  const organization = columns.organizationId
    ? undefined
    : await repo.organizations.create({ name: title });
  const project = await repo.projects.create({
    ...columns,
    // Spread first, defaults last: `Partial<ProjectInsert>` types every
    // field as `T | undefined`, and a trailing spread would otherwise
    // widen `title` / `createdBy` to that even when `overrides` doesn't
    // actually set them, tripping `create()`'s non-optional parameter type.
    title,
    // `ProjectController.createProject` derives this and every URL in the app
    // is built from it, so a fixture project without one is a project nothing
    // can link to. The counter keeps it unique the same way the title is —
    // `projects.slug` carries a unique index.
    slug:
      overrides.slug ??
      `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${projectSeq}`,
    createdBy: overrides.createdBy ?? owner.id,
    organizationId: columns.organizationId ?? organization!.id,
  });

  await repo.organizationMembers.create({
    organizationId: project.organizationId!,
    userId: project.createdBy,
    rank: "owner",
  });

  const ALL_ON: Array<{
    key: CapabilityKey;
    options: Record<string, boolean>;
  }> = [
    {
      key: "work",
      options: {
        board: true,
        epics: true,
        releases: true,
        estimate: true,
        chrono: true,
        reminder: true,
      },
    },
    { key: "knowledge", options: { agentSummary: true } },
    { key: "apps", options: { track: true, deploy: false } },
    { key: "support", options: {} },
  ];

  for (const capability of capabilities ?? ALL_ON) {
    await repo.capabilities.create({
      projectId: project.id,
      key: capability.key,
      options: capability.options ?? {},
    });
  }

  return project;
};

/**
 * Gives a user a membership row in a project.
 *
 * `createTestProject` deliberately bypasses `ProjectController`, which is
 * what writes the owner's own membership on create — so anything that reads
 * a user's projects through the `users.projects` relation (it hops through
 * `members`) sees nothing until this runs.
 */
export const createTestMember = async (
  alepha: Alepha,
  project: Pick<Project, "id" | "createdBy" | "organizationId">,
  userId: string,
  // ⚠️ No `owner`. The column is retired (#Q1997) and its database DEFAULT is
  // `true`, so every row written now says `true` and means nothing. A fixture
  // that could still set it would let a spec claim to be testing a non-owner
  // while the only column anything reads says otherwise.
  overrides: Partial<{ rank: string }> = {},
): Promise<OrganizationMember> => {
  const repo = CoreTestEntities.of(alepha);

  // ⚠️ Idempotent, because `createTestProject` now writes the creator's own
  // membership row. `members` carries a unique index on `(userId, projectId)`,
  // so a spec that adds the creator explicitly - a perfectly reasonable thing
  // to have written before ranks existed - would otherwise fail on a
  // constraint rather than on anything it was testing.
  const existing = await repo.organizationMembers.findOne({
    where: {
      organizationId: { eq: project.organizationId! },
      userId: { eq: userId },
    },
  });

  if (existing) {
    if (overrides.rank !== undefined) {
      return repo.organizationMembers.updateById(existing.id, {
        rank: overrides.rank,
      });
    }
    return existing;
  }

  return repo.organizationMembers.create({
    organizationId: project.organizationId!,
    userId,
    ...(overrides.rank === undefined ? {} : { rank: overrides.rank }),
  });
};

export const createTestMemberByProjectId = async (
  alepha: Alepha,
  projectId: number,
  userId: string,
  overrides: Partial<{ rank: string }> = {},
): Promise<OrganizationMember> => {
  const security = alepha.inject(ProjectSecurityService);
  const organizationId = await security.organizationIdOf(projectId);
  const existing = await security.members.findOne({
    where: { organizationId: { eq: organizationId }, userId: { eq: userId } },
  });
  if (existing) {
    return overrides.rank === undefined
      ? existing
      : security.members.updateById(existing.id, { rank: overrides.rank });
  }
  return security.members.create({
    organizationId,
    userId,
    ...(overrides.rank === undefined ? {} : { rank: overrides.rank }),
  });
};
