import { t } from "alepha";

/**
 * Petition form fields the dialog submits (multipart, alongside the screenshot file).
 */
export const sigilPetitionFields = t.object({
  title: t.string({ minLength: 1, maxLength: 200 }),
  description: t.string({ maxLength: 10_000 }),
  type: t.enum(["bug", "feature"], { mode: "text" }),
  hostUrl: t.string({ maxLength: 2000 }),
  hostPath: t.string({ maxLength: 2000 }),
});
