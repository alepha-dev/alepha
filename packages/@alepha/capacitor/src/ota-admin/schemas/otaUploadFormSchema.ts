import { z } from "alepha";

/**
 * The two files `alepha capacitor release --dry-run` writes.
 */
export const otaUploadFormSchema = z.object({
  manifest: z.file(),
  bundle: z.file(),
});
