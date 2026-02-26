import type { Static } from "alepha";
import { t } from "alepha";

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const vercelProjectSchema = t.object({
  id: t.string(),
  name: t.string(),
  accountId: t.string(),
});

export type VercelProject = Static<typeof vercelProjectSchema>;

export const createProjectBodySchema = t.object({
  name: t.string(),
  framework: t.optional(t.null()),
});

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export const vercelDeploymentSchema = t.object({
  uid: t.string(),
  name: t.string(),
  url: t.string(),
  state: t.optional(t.string()),
  readyState: t.optional(t.string()),
  created: t.optional(t.number()),
  target: t.optional(t.string()),
  alias: t.optional(t.array(t.string())),
});

export type VercelDeployment = Static<typeof vercelDeploymentSchema>;

// ---------------------------------------------------------------------------
// Environment Variable
// ---------------------------------------------------------------------------

export const vercelEnvVarSchema = t.object({
  id: t.string(),
  key: t.string(),
  value: t.optional(t.string()),
  type: t.string(),
  target: t.array(t.string()),
});

export type VercelEnvVar = Static<typeof vercelEnvVarSchema>;

export const createEnvVarBodySchema = t.object({
  key: t.string(),
  value: t.string(),
  type: t.string(),
  target: t.array(t.string()),
});
