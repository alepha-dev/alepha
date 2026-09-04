import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { epicReviewPromptAtom } from "@/web/app/atoms/epicReviewPromptAtom.ts";
import { buildEpicReviewPrompt } from "@/web/app/prompts/epicReviewPrompt.ts";

import { formatReference } from "../../shared/element/typedReference.ts";

/**
 * Opens the epic-review prompt for editing.
 *
 * A hook rather than a copy in each caller, because there are two: the Epics
 * row menu and the epic's own page. The label they show comes from one i18n
 * key for the same reason `Begin` does - two surfaces reading one key cannot
 * come to call the action different things.
 *
 * ⚠️ It no longer writes the clipboard. #2087 shipped Review as a blind
 * copy: the reader never saw the text they were about to paste, and could not
 * add the one sentence of context that makes a review land (feedback #2097).
 * This builds the prompt and hands it to `EpicReviewPromptDialog`, mounted
 * once in `Layout`, which owns the editing AND the copy - the write has to
 * happen inside the dialog button's own click, or Safari's transient
 * activation has expired by the time a resolved promise gets there.
 *
 * Both call sites are unchanged one-liners, which is the property this hook
 * exists for.
 */
export const useEpicReviewPrompt = (): ((epic: EpicResource) => void) => {
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);
  const [, setPrompt] = useStore(epicReviewPromptAtom);

  return (epic) => {
    const path = router.path("projectEpic", {
      params: { epicNumber: String(epic.number) },
    });
    // Absolute where there is a window, a path otherwise. Same reasoning as
    // the roadmap URL's: the epic page is member-gated and so is
    // client-rendered, but a path is still the honest answer rather than an
    // origin invented on the server.
    const url =
      typeof window === "undefined" ? path : `${window.location.origin}${path}`;

    const prompt = buildEpicReviewPrompt({
      projectSlug: project?.slug ?? "",
      epicNumber: epic.number,
      epicTitle: epic.title,
      url,
    });

    setPrompt({
      reference: formatReference("epic", epic.number),
      text: prompt,
    });
  };
};
