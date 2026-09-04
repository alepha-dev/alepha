import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { buildEpicReviewPrompt } from "@/web/app/prompts/epicReviewPrompt.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

/**
 * Puts the epic-review prompt on the clipboard, and says so.
 *
 * A hook rather than a copy in each caller, because there are two: the Epics
 * row menu and the epic's own page. The label they show comes from one i18n
 * key for the same reason `Begin` does - two surfaces reading one key cannot
 * come to call the action different things.
 *
 * The clipboard write is the row menu's own copy-id pattern, unchanged:
 * `await` inside `try`, a success toast naming what was copied, an error
 * toast in `catch`. `navigator.clipboard.writeText` needs a user gesture and
 * a secure context and it REJECTS, so a toast fired before the write
 * resolved would be a lie.
 */
export const useEpicReviewPrompt = (): ((
  epic: EpicResource,
) => Promise<void>) => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);

  return async (epic) => {
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

    try {
      await navigator.clipboard.writeText(prompt);
      toaster.success(
        tr("epic.action.review.copied", { args: [`#${epic.number}`] }),
      );
    } catch {
      toaster.error(tr("epic.action.review.error"));
    }
  };
};
