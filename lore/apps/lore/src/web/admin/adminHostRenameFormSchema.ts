import { z } from "alepha";

/**
 * The admin's Rename dialog (#Q3664): a host's slug and its display name.
 * The server normalises and checks the slug; the form only bounds it.
 */
export const adminHostRenameFormSchema = z.object({
  slug: z.text({ maxLength: 64 }),
  label: z.text({ maxLength: 100 }).optional(),
});
