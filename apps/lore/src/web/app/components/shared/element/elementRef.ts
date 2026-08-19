import type { ElementKind } from "@/api/schemas/elementKindSchema.ts";

/**
 * Addresses the element a `LoreEditor` / `LoreViewer` is showing.
 *
 * One object rather than four loose props because every capability the pair
 * derives — which bucket an image uploads into, what the `[[` picker
 * offers, which links resolve — is a function of the whole tuple, and a
 * surface that passed three of the four would compile and then behave
 * subtly wrong.
 *
 * Both ids are here on purpose. `projectId` addresses the API (integer),
 * `projectSlug` addresses the links the rewrite produces (URLs). Neither
 * substitutes for the other, and passing one where the other belongs is a
 * mistake this repo has already made once.
 */
export interface ElementRef {
  kind: ElementKind;
  projectId: number;
  projectSlug: string;
  /**
   * The element's own id — a folio's UUID, a quest's or epic's integer.
   * Absent while the element is being created and has none yet, which is
   * what disables blob resolution and image upload for a draft folio.
   */
  id?: string | number;
}
