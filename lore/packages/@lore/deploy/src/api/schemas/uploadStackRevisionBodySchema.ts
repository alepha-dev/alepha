import { z } from "alepha";

/**
 * The body of `uploadStackRevision`: a compose file, or a tar bundle holding
 * one. Shared with the upload form, built from the action (`useActionForm`),
 * so a file over the limit is refused before it is sent.
 *
 * The 16 MiB is `StackBundleReader.MAX_BYTES`, which lives in a service this
 * file cannot import (the browser loads it).
 */
export const uploadStackRevisionBodySchema = z.object({
  file: z.file({ maxBytes: 16 * 1024 * 1024 }),
});
