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
   * `archive` or `image`. Which kind of thing this variant is.
   *
   * ⚠️ Without it a caller cannot tell two `node` variants of one tag apart,
   * and every surface that keys on `runtime` alone collides. `z.string()`
   * rather than the enum, matching the column: a value the enum has never
   * heard of must render as itself, not fail the whole payload.
   */
  format: z.string(),
  /**
   * The pullable string for an image, absent for an archive.
   *
   * ⚠️ `z.string()`, not `z.text()`, for the reason at the top of this file:
   * `z.text()` caps at 255 and the column allows 512, so a long reference
   * would make the whole payload fail to serialize rather than truncate.
   */
  reference: z.string().optional(),
  /**
   * Lowercase hex, 64 characters. The artifact's identity: the tarball's
   * digest for an archive, the index digest for an image.
   */
  sha256: z.string(),
  /**
   * ⚠️ **Optional, and every surface has to render "no size".**
   *
   * An archive always has one. An image's is best effort: summed from the
   * child manifest the registry client already held, so it costs no extra
   * call, and absent whenever that document did not answer it. Where it IS
   * present for an image it is ONE architecture's compressed total for a tag
   * that may carry two.
   *
   * A sentinel `0` was rejected: this field is read by four surfaces and a
   * value meaning "ignore me" is how one of them ends up printing `0 MB` as
   * if it were a fact.
   */
  size: z.integer().optional(),
  /**
   * Absent when the pusher named no commit, which a laptop push never does.
   */
  commitSha: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ArtifactResource = Infer<typeof artifactResourceSchema>;
