import { type Infer, z } from "alepha";

import { projectRepositories } from "../entities/projectRepositories.ts";

/**
 * A project's GitHub repository as settings, the CLI and MCP show it
 * (#Q4362): the repository, who connected it and when, and why it stopped
 * being connected when it did. Never a token.
 */
export const projectGitHubConnectionSchema = projectRepositories.schema
  .pick({
    repositoryId: true,
    installationId: true,
    owner: true,
    name: true,
    defaultBranch: true,
    connectedAt: true,
    disconnectedAt: true,
    disconnectReason: true,
  })
  .extend({
    fullName: z.string(),
    url: z.string(),
    connected: z.boolean(),
    connectedBy: z
      .object({ id: z.uuid(), name: z.string().optional() })
      .optional(),
  });

export type ProjectGitHubConnection = Infer<
  typeof projectGitHubConnectionSchema
>;
