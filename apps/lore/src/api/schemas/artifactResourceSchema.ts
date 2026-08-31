import { type Infer, z } from "alepha";

/**
 * One stored build, as every read surface sees it.
 *
 * ⚠️ **The bytes are never in here.** A listing is a page of metadata and an
 * MCP response is a token budget; a multi-megabyte tarball has no business in
 * either. Fetching the artifact itself is a separate, authenticated download.
 *
 * ⚠️ `z.string()`, not `z.text()`. `z.text()` caps at 255 characters, which is
 * fine for every field here and would be a silent blank screen the day one of
 * them grows - the cost of the cap is paid on the response, where a field that
 * overflows it makes the whole payload fail to serialize.
 */
export const artifactResourceSchema = z.object({
  id: z.uuid(),
  projectId: z.integer(),
  app: z.string(),
  /**
   * Case-preserved: this is the join key to `releases.tag`.
   */
  tag: z.string(),
  runtime: z.string(),
  /**
   * Lowercase hex, 64 characters. The artifact's identity.
   */
  sha256: z.string(),
  size: z.integer(),
  /**
   * Absent when the pusher named no commit, which a laptop push never does.
   */
  commitSha: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ArtifactResource = Infer<typeof artifactResourceSchema>;
