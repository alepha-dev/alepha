import { type Infer, z } from "alepha";
import { DEPLOYMENT_STATUSES } from "../entities/deployments.ts";

/**
 * A release as a deploying client sees it.
 *
 * `fileId` is absent: knowing where the bytes are stored is the outpost's
 * business, delivered on the command channel with the credential that earns
 * it. A caller watching a deploy needs to know what is happening, not where to
 * fetch the artifact from.
 *
 * `sha256` stays, because it is the identity of what was shipped — the one
 * value that lets a caller prove the thing serving is the thing it built.
 */
export const releaseResourceSchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  app: z.string(),
  environment: z.string(),
  version: z.string(),
  sha256: z.string(),
  sizeBytes: z.integer().optional(),
  status: z.enum([...DEPLOYMENT_STATUSES]).meta({ mode: "text" }),
  /** Bay's own words, verbatim. Absent unless `status` is `failed`. */
  failureReason: z.string().optional(),
  /** Which machine took it. Absent until claimed. */
  outpostId: z.uuid().optional(),
  claimedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ReleaseResource = Infer<typeof releaseResourceSchema>;
