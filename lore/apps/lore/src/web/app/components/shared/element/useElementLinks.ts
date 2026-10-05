import { useInject } from "alepha/react";
import { useMemo, useRef } from "react";

import {
  ElementReferenceRegistry,
  type ElementReferenceSet,
} from "../../../registries/ElementReferenceRegistry.ts";
import type { ElementRef } from "./elementRef.ts";
import { rewriteWikiLinks } from "./rewriteWikiLinks.ts";
import type { AttachmentRef, ElementReference } from "./wikiLinkResolver.ts";
import type { WikiLinkSuggestion } from "./wikiLinkSuggestion.ts";

export interface ElementLinks {
  /**
   * What the `[[` picker offers in Edit mode.
   */
  suggestions: WikiLinkSuggestion[];
  /**
   * `content` with `[[…]]` turned into real markdown links and
   * `assets/<name>` turned into `/api/files/<id>` — what View mode renders.
   *
   * The stored markdown is never touched: this is a display transform, so
   * an exported element keeps the portable relative paths that make it a
   * copy rather than a transform.
   */
  rendered: string;
}

/**
 * Both halves of wiki-link support - the picker's entries and the rendered
 * markdown - for ANY element, from one set of lookups.
 *
 * Replaces the two hooks that used to do this: `useFolioWikiLinks` (folio
 * workspace) and `useWikiLinkRewrite` (quest description). They resolved the
 * same syntax against the same tables and had drifted anyway: only the folio
 * one offered suggestions, so `[[` autocomplete existed on exactly one
 * surface while the syntax it inserts worked on three.
 *
 * ## Each kind is its module's (#E75, #Q2624)
 *
 * What a kind holds, and where it reads it from, is the `useReferences` hook
 * its module registered on `ElementReferenceRegistry`: Knowledge reads the
 * folio workspace's atoms inside it and fetches everywhere else, Work reads
 * releases from the project layout's atom and fetches quests, epics and
 * feedback through project-scoped `useQuery` keys, so walking from a quest
 * to a folio to an epic pays for them once, not once per surface. Each one
 * resolves the numbers the body names, not only its capped picker page
 * (#Q2355), so a reference to a row outside the recent page still renders.
 *
 * The picker lists every kind's suggestions in registration order: folios,
 * then quests, then epics.
 */
export const useElementLinks = (
  element: ElementRef,
  content: string,
): ElementLinks => {
  const registry = useInject(ElementReferenceRegistry);
  const kinds = registry.kinds();

  // One hook per registered kind. Legal because the registry is frozen
  // before the first render (see `ElementReferenceRegistry`), so this loop
  // is the same length, in the same order, on every render.
  const sets = kinds.map((kind) =>
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- the kinds are frozen at boot, so the hook order never changes
    kind.useReferences(element, content),
  );

  // Each kind memoizes its own set, so the sets keep their identity until
  // one of them changes; the merge below is redone only then, not on every
  // keystroke in the editor.
  const previous = useRef<ElementReferenceSet[]>([]);
  const stable =
    sets.length === previous.current.length &&
    sets.every((set, index) => set === previous.current[index])
      ? previous.current
      : sets;
  previous.current = stable;

  const merged = useMemo(() => {
    const refs: Record<string, ElementReference[]> = {};
    const suggestions: WikiLinkSuggestion[] = [];
    const attachments: AttachmentRef[] = [];
    kinds.forEach((kind, index) => {
      const set = stable[index];
      refs[kind.kind] = set.refs;
      suggestions.push(...(set.suggestions ?? []));
      attachments.push(...(set.attachments ?? []));
    });
    return { refs, suggestions, attachments };
  }, [kinds, stable]);

  const rendered = useMemo(
    () =>
      element.projectSlug
        ? rewriteWikiLinks(content, {
            projectSlug: element.projectSlug,
            kinds,
            refs: merged.refs,
            attachments: merged.attachments,
          })
        : content,
    [content, element.projectSlug, kinds, merged],
  );

  return { suggestions: merged.suggestions, rendered };
};
