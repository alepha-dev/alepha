import { z } from "alepha";

/**
 * A project title.
 *
 * Constrained to letters, digits, space, `-` and `_` because the title is what
 * derives the project's URL slug (`ProjectSlugService.slugify`). Unicode
 * letters are allowed on purpose — Lore ships EN and FR, and rejecting
 * "Élan Vital" would be hostile; the slug folds the accent instead.
 *
 * The first character must be a letter or digit, so a title cannot be made
 * entirely of separators.
 *
 * ⚠️ Enforced on **write only**. Titles created before this schema existed may
 * violate it and must keep loading — never validate on read.
 */
export const projectTitleSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u);
