import type { Static } from "alepha";
import { z } from "alepha";

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const vercelProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  accountId: z.string(),
});

export type VercelProject = Static<typeof vercelProjectSchema>;

export const createProjectBodySchema = z.object({
  name: z.string(),
  framework: z.null().optional(),
});

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

export const vercelDeploymentSchema = z.object({
  uid: z.string(),
  name: z.string(),
  url: z.string(),
  state: z.string().optional(),
  readyState: z.string().optional(),
  created: z.number().optional(),
  target: z.string().optional(),
  alias: z.array(z.string()).optional(),
});

export type VercelDeployment = Static<typeof vercelDeploymentSchema>;

// ---------------------------------------------------------------------------
// Environment Variable
// ---------------------------------------------------------------------------

export const vercelEnvVarSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string().optional(),
  type: z.string(),
  target: z.array(z.string()),
});

export type VercelEnvVar = Static<typeof vercelEnvVarSchema>;

export const createEnvVarBodySchema = z.object({
  key: z.string(),
  value: z.string(),
  type: z.string(),
  target: z.array(z.string()),
});
