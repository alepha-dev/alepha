import type { Alepha, Infer } from "alepha";
import { users } from "alepha/api/users";
import { $repository } from "alepha/orm";

import { areas } from "@/api/entities/areas.ts";
import { type Epic, epics } from "@/api/entities/epics.ts";
import { feedback } from "@/api/entities/feedback.ts";
import { folioDirectories } from "@/api/entities/folioDirectories.ts";
import { type Folio, folios } from "@/api/entities/folios.ts";
import { type Member, members } from "@/api/entities/members.ts";
import { type Project, projects } from "@/api/entities/projects.ts";
import { type Quest, type QuestInsert, quests } from "@/api/entities/quests.ts";
import { releases } from "@/api/entities/releases.ts";

type ProjectInsert = Infer<typeof projects.insertSchema>;
type EpicInsert = Infer<typeof epics.insertSchema>;
type FolioInsert = Infer<typeof folios.insertSchema>;

/**
 * Repository bag backing the `createTest*` helpers below, and the thing a
 * spec needs to construct BEFORE `alepha.start()`.
 *
 * `$entity`'s `db.ref` foreign keys are resolved once, when the database is
 * synchronized at boot — and only against tables whose `Repository` has
 * already been constructed by then (each `Repository` registers its own
 * table with the provider from its constructor). `quests` alone reaches
 * `projects`, `releases`, `feedback` and `users` via FK columns, so a spec
 * that only wires up `epics` + `quests` before `start()` and creates a
 * `quests` row afterwards through `createTestQuest` fails at boot with
 * "Referenced table X not found" — not at the call site that actually
 * needed it.
 *
 * A spec using any `createTest*` helper below should give its own
 * pre-`start()` class every field this class has (or `extends` it), so the
 * whole FK closure gets registered up front.
 */
export class TestEntityRepositories {
  projects = $repository(projects);
  members = $repository(members);
  releases = $repository(releases);
  feedback = $repository(feedback);
  users = $repository(users);
  areas = $repository(areas);
  epics = $repository(epics);
  quests = $repository(quests);
  folios = $repository(folios);
  // `folios.directoryId` refs this table — needed pre-`start()` whenever
  // `folios` is, for the same reason `quests`'s own FK closure is.
  folioDirectories = $repository(folioDirectories);
}

/**
 * These counters make fixture rows unique (project titles, quest `shortId`,
 * epic `number` all carry a `(projectId, ...)` unique index). A single
 * monotonic counter per entity is enough: it never repeats within a
 * process, so it never collides within any one project either. It does NOT
 * reproduce the real per-project 1-based numbering the app allocates via
 * `$sequence` — tests that care about that allocate their own numbers
 * through the real controller/service instead of these fixtures.
 */
let projectSeq = 0;
let questSeq = 0;
let epicSeq = 0;
let folioSeq = 0;

/**
 * Creates a project directly through the repository, bypassing
 * `ProjectController` (auth, slug derivation, membership rows). Fine for
 * tests that only need a valid `projectId` to hang other rows off.
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
  overrides: Partial<ProjectInsert> = {},
): Promise<Project> => {
  const repo = alepha.inject(TestEntityRepositories);
  const owner = await repo.users.create({});
  projectSeq += 1;
  const title = overrides.title ?? `Test Project ${projectSeq}`;
  return repo.projects.create({
    ...overrides,
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
  });
};

/**
 * Creates a quest directly through the repository, bypassing
 * `QuestController` / `QuestService` (auth, `$sequence`-allocated `shortId`,
 * area bookkeeping). `createdBy` defaults to the project's own owner so
 * callers that don't care about attribution don't have to invent a user.
 */
export const createTestQuest = async (
  alepha: Alepha,
  project: Project,
  overrides: Partial<QuestInsert> = {},
): Promise<Quest> => {
  const repo = alepha.inject(TestEntityRepositories);
  questSeq += 1;
  return repo.quests.create({
    ...overrides,
    // Spread first, defaults last — see `createTestProject`. `history`
    // needs the same treatment as the other required fields below even
    // though it looks defaultable: it is a plain `z.array().default([])`,
    // not `db.default(...)`, so `QuestInsert` does not mark it optional.
    shortId: overrides.shortId ?? questSeq,
    title: overrides.title ?? `Test Quest ${questSeq}`,
    description: overrides.description ?? "",
    area: overrides.area ?? "general",
    priority: overrides.priority ?? "medium",
    projectId: overrides.projectId ?? project.id,
    createdBy: overrides.createdBy ?? project.createdBy,
    history: overrides.history ?? [],
  });
};

/**
 * Creates an epic directly through the repository, bypassing
 * `EpicController` and its `$sequence`-allocated `number`.
 */
export const createTestEpic = async (
  alepha: Alepha,
  project: Project,
  overrides: Partial<EpicInsert> = {},
): Promise<Epic> => {
  const repo = alepha.inject(TestEntityRepositories);
  epicSeq += 1;
  return repo.epics.create({
    ...overrides,
    // Spread first, defaults last — see `createTestProject`.
    projectId: overrides.projectId ?? project.id,
    number: overrides.number ?? epicSeq,
    title: overrides.title ?? `Test Epic ${epicSeq}`,
    description: overrides.description ?? "",
    status: overrides.status ?? "planned",
  });
};

/**
 * Creates a folio directly through the repository, bypassing
 * `FolioController` (auth, `$sequence`-allocated `shortId`, search-text
 * indexing, link sync). Fine for tests that only need a valid folio row
 * to attach/detach or hang other assertions off.
 */
export const createTestFolio = async (
  alepha: Alepha,
  project: Project,
  overrides: Partial<FolioInsert> = {},
): Promise<Folio> => {
  const repo = alepha.inject(TestEntityRepositories);
  folioSeq += 1;
  return repo.folios.create({
    ...overrides,
    // Spread first, defaults last — see `createTestProject`.
    projectId: overrides.projectId ?? project.id,
    shortId: overrides.shortId ?? folioSeq,
    title: overrides.title ?? `Test Folio ${folioSeq}`,
  });
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
  project: Project,
  userId: string,
  overrides: Partial<{ owner: boolean }> = {},
): Promise<Member> => {
  const repo = alepha.inject(TestEntityRepositories);
  return repo.members.create({
    projectId: project.id,
    userId,
    owner: overrides.owner ?? true,
  });
};
