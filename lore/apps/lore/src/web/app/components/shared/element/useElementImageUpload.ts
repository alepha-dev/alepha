import { useInject } from "alepha/react";

import { ElementReferenceRegistry } from "../../../registries/ElementReferenceRegistry.ts";
import type { ElementRef } from "./elementRef.ts";

/**
 * The image-upload handler for an element's markdown, chosen by kind.
 *
 * Every surface used to pick its own, which is how the epic description
 * ended up with none by accident rather than by decision. Here the choice
 * is one switch, and the reason each arm differs is written down beside it.
 *
 * Both hooks are called unconditionally — hooks cannot be called behind a
 * branch — and the branch only decides which result is returned.
 */
export const useElementImageUpload = (
  element: ElementRef,
  enabled = true,
): ((file: File) => Promise<string>) | undefined => {
  const registry = useInject(ElementReferenceRegistry);

  // One hook per registered kind with an attachment store, each answering
  // only for an element of its own kind (#E75, #Q2624). Legal for the reason
  // `useElementLinks` gives: the kinds are frozen before the first render.
  //
  // A kind with no store answers nothing, so an epic body gets no upload:
  // borrowing another kind's bucket would upload fine and then leave a file
  // nobody but its uploader is granted.
  const uploads = registry.kinds().map((kind) =>
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- the kinds are frozen at boot, so the hook order never changes
    kind.useImageUpload?.(element, enabled && element.kind === kind.kind),
  );

  if (!enabled) return undefined;
  const index = registry
    .kinds()
    .findIndex((kind) => kind.kind === element.kind);
  return index === -1 ? undefined : uploads[index];
};
