import { z } from "alepha";

/**
 * The Media tab's form: one field, holding the ordered list of image
 * references.
 *
 * Its own form rather than a field on the product editor because `ControlUpload`
 * writes as files finish uploading, and sharing the editor's form would leave
 * that form dirty — and its Reset button able to discard an upload that already
 * happened.
 *
 * `products.images` is `string[]` of file ids **or** absolute URLs, so nothing
 * here validates a uuid shape.
 */
export const imagesFormSchema = z.object({
  images: z.array(z.text({ maxLength: 500 })),
});
