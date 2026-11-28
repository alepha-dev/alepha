import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";
import { users } from "./users.ts";

/**
 * Why a project's repository stopped being connected (#Q4362).
 */
export const PROJECT_REPOSITORY_DISCONNECT_REASONS = [
  "member",
  "uninstalled",
  "suspended",
  "removed",
] as const;

/**
 * The GitHub repository a project is connected to (#Q4362, epic #E177).
 *
 * **One project, one repository; one repository in at most one project**:
 * unique on `projectId` and on `repositoryId`, so a webhook never has to guess
 * which project `#Q12` belongs to. GitHub's numeric repository id is the
 * identity: a rename or a transfer changes `owner` and `name` and breaks
 * nothing, and the names a record was made under stay matchable through
 * `formerNames` (#Q4367).
 *
 * A row outlives its disconnection (`disconnectedAt`, `disconnectReason`) so
 * settings can say why; connecting again replaces it. A disconnected row of
 * another project never blocks a connect: the connect deletes it first.
 */
export const projectRepositories = $entity({
  name: "project_repositories",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    installationId: z.integer(),
    repositoryId: z.integer(),
    owner: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    defaultBranch: z.string().min(1).max(255),
    /**
     * Earlier `owner/name` of the repository, newest first, at most ten: a
     * pull request recorded before a rename still matches its row.
     */
    formerNames: z.array(z.string().max(201)).max(10).optional(),
    connectedBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    /**
     * The GitHub user the install callback's user token named: not required
     * to be the member's linked sign-in (an organization admin may install
     * for a member), recorded for the trail.
     */
    connectedByGithubId: z.integer().optional(),
    connectedAt: z.string(),
    disconnectedAt: z.string().optional(),
    disconnectReason: z
      .enum(PROJECT_REPOSITORY_DISCONNECT_REASONS)
      .meta({ mode: "text" })
      .optional(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
  indexes: [
    { columns: ["projectId"], unique: true },
    { columns: ["repositoryId"], unique: true },
    { columns: ["installationId"] },
  ],
});

export type ProjectRepository = Infer<typeof projectRepositories.schema>;
