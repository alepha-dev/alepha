import { z } from "alepha";

/**
 * The `GET /version` response.
 *
 * ⚠️ **Every field is optional**, which is not the same thing as the record
 * being optional. `versionOptions.expose` lets an app trim the payload - most
 * usefully to publish its version while withholding the commit SHA - so any
 * field can legitimately be absent. A consumer must treat absence as "not
 * disclosed" rather than "unknown".
 *
 * `z.text()` caps at 255 characters, which every one of these is far inside.
 * Worth stating because the failure mode on a response schema is a blank
 * response rather than a truncated field, and a unit test that calls the
 * handler directly never sees it.
 */
export const versionSchema = z.object({
  name: z.text().optional(),
  version: z.text().optional(),
  commit: z.text().optional(),
  build: z
    .object({
      date: z.text().optional(),
      runtime: z.text().optional(),
      dev: z.boolean().optional(),
    })
    .optional(),
  framework: z.text().optional(),
});
