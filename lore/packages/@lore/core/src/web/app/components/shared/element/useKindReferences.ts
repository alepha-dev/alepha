import { useInject } from "alepha/react";

import { ElementReferenceRegistry } from "../../../registries/ElementReferenceRegistry.ts";
import type { ElementRef } from "./elementRef.ts";
import type { ElementReference } from "./wikiLinkResolver.ts";

/**
 * One registered reference kind's rows for a page, and where each lives,
 * without the page naming the module that owns the kind (#E75, #Q2624).
 * Empty when no module registered the kind.
 *
 * Deploy's artifact list links a tag to its release this way: by the
 * `release` kind, not by Work's releases atom.
 */
export const useKindReferences = (
  kind: string,
  element: ElementRef,
): KindReferences => {
  const registry = useInject(ElementReferenceRegistry);
  const registered = registry.kinds().find((it) => it.kind === kind);

  // Conditional on the registry, which is frozen before the first render, so
  // the hook is called on every render or on none (see
  // `ElementReferenceRegistry`).
  const set = registered?.useReferences(element, "");

  return {
    refs: set?.refs ?? [],
    href: (ref) =>
      registered ? registered.href(element.projectSlug, ref) : undefined,
  };
};

export interface KindReferences {
  refs: ElementReference[];
  href: (ref: ElementReference) => string | undefined;
}
