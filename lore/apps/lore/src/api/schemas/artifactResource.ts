import { z } from "alepha";

/**
 * One artifact, as the registry hands it out.
 *
 * `fileId` is absent on purpose. It names where the bytes live today, which is
 * this deployment's business and nobody else's — a client that needs the bytes
 * asks the outpost channel for them, which checks the digest.
 */
export const artifactResourceSchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  app: z.string(),
  tag: z.string(),
  sha256: z.string(),
  sizeBytes: z.integer().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
