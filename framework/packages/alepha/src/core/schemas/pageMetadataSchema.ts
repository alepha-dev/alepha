import { z } from "../providers/ZodProvider.ts";

/**
 * The `page` object of a paginated response: position, totals and sort.
 *
 * Read off `z.page()`, which owns the definition, so that `z.page()` and
 * `pageSchema()` publish the same schema.
 */
export const pageMetadataSchema = z.page(z.object({})).shape.page;
