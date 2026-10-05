import { useStore } from "alepha/react";
import { useMemo } from "react";

import { currentReleasesAtom } from "../../../atoms/currentReleasesAtom.ts";
import type { ElementReferenceSet } from "../../../registries/ElementReferenceRegistry.ts";
import type { ElementRef } from "../../shared/element/elementRef.ts";

/**
 * The releases an element body can reference, registered by `WorkShell` on
 * core's `ElementReferenceRegistry` (#E75, #Q2624). Every release, with its
 * number, tag and title, is already in the project layout's atom, so
 * `[[#R12]]` costs no request. Not offered by the picker.
 */
export const useReleaseReferences = (
  // Unread: the atom is the project's, whatever the element.
  _element: ElementRef,
  _content: string,
): ElementReferenceSet => {
  const [releases] = useStore(currentReleasesAtom);

  return useMemo(
    () => ({
      refs: (releases ?? []).map((r) => ({
        number: r.number,
        title: r.title,
        tag: r.tag,
      })),
    }),
    [releases],
  );
};
