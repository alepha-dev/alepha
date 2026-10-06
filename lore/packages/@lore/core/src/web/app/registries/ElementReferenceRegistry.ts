import { AlephaError } from "alepha";
import type { ComponentType } from "react";

import type { ElementRef } from "../components/shared/element/elementRef.ts";
import type {
  AttachmentRef,
  ElementReference,
  ElementReferenceLinks,
} from "../components/shared/element/wikiLinkResolver.ts";
import type { WikiLinkSuggestion } from "../components/shared/element/wikiLinkSuggestion.ts";

/**
 * What every editor and viewer knows about `[[#Q12]]` references, kind by
 * kind (#E75, #Q2624): which rows a kind holds, what the `[[` picker offers
 * from them, where one links to, what its hover card shows, and where an
 * image pasted into that kind of element is uploaded.
 *
 * `useElementLinks`, `useElementImageUpload` and `WikiLinkHoverProvider` are
 * core and name no kind: Work registers quests, epics, feedback and releases
 * (`WorkShell`), Knowledge registers folios (`KnowledgeShell`).
 *
 * ## ⚠️ The kinds are frozen once read
 *
 * Each kind carries HOOKS (`useReferences`, `useImageUpload`), and the core
 * hooks call one per registered kind, in a loop. That is only legal while
 * the loop is the same length on every render, so the set is closed the
 * first time it is read: every shell registers from its constructor, at
 * boot, before anything renders, and a late registration throws rather than
 * changing the hook order under a mounted editor.
 */
export class ElementReferenceRegistry {
  protected readonly entries: ElementReferenceKind[] = [];
  protected frozen = false;

  public register(kind: ElementReferenceKind): void {
    if (this.frozen) {
      throw new AlephaError(
        `Reference kind '${kind.kind}' registered after the editor first read the kinds`,
      );
    }
    if (this.entries.some((it) => it.kind === kind.kind)) {
      throw new AlephaError(
        `Reference kind '${kind.kind}' is registered twice`,
      );
    }
    this.entries.push(kind);
    this.entries.sort((a, b) => a.order - b.order);
  }

  /**
   * Every registered kind, in `order`: the picker's order too.
   */
  public kinds(): readonly ElementReferenceKind[] {
    this.frozen = true;
    return this.entries;
  }

  /**
   * The kind whose page an href points at, and the id its preview reads.
   */
  public match(
    path: string,
    projectSlug: string,
  ): { kind: ElementReferenceKind; id: string } | undefined {
    for (const kind of this.kinds()) {
      const id = kind.match(path, projectSlug);
      if (id !== undefined) return { kind, id };
    }
    return undefined;
  }
}

/**
 * One kind of `[[...]]` reference.
 */
export interface ElementReferenceKind extends ElementReferenceLinks {
  /**
   * Position in the `[[` picker, ascending. The picker shows the first eight
   * matches and every entry inserts the same `#<LETTER><n>` shape, so the
   * order only says what a body most often points at: notes cite notes.
   */
  order: number;
  /**
   * The i18n key the hover card explains a `<kind>-not-found` with.
   */
  brokenKey: string;
  /**
   * Recognise an href this kind's `href` produced, and answer the id its
   * preview reads. Only for this project: a link into another project is
   * left alone.
   */
  match: (path: string, projectSlug: string) => string | undefined;
  /**
   * The hover card's body for one row. It fetches what it shows, and
   * renders `WikiLinkPreviewState` while it cannot.
   */
  preview: ComponentType<WikiLinkPreviewProps>;
  /**
   * A HOOK: the rows this kind holds for one element body, what the picker
   * offers from them, and, for the kind that has them, the element's
   * attachments. Called on every render of every editor and viewer, so it
   * gates its own requests on what the body names.
   */
  useReferences: (element: ElementRef, content: string) => ElementReferenceSet;
  /**
   * A HOOK: the upload handler for an image pasted into an element of this
   * kind, or `undefined` when the kind has no attachment store. Called for
   * every kind on every render; it answers for `element` only when
   * `element.kind` is its own.
   */
  useImageUpload?: (
    element: ElementRef,
    enabled: boolean,
  ) => ((file: File) => Promise<string>) | undefined;
}

export interface ElementReferenceSet {
  refs: ElementReference[];
  suggestions?: WikiLinkSuggestion[];
  attachments?: AttachmentRef[];
}

export interface WikiLinkPreviewProps {
  projectId: number;
  /**
   * What `match` answered for the hovered link.
   */
  id: string;
}
