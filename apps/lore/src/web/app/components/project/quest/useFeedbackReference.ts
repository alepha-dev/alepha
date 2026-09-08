import { useClient, useQuery, useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";

import type { FeedbackController } from "@/api/controllers/FeedbackController.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { formatReference } from "../../shared/element/typedReference.ts";

/**
 * The `#P` reference and the URL for a feedback row a quest came from.
 *
 * `quests.feedbackId` is the feedback row's DATABASE id, and the number a
 * reader knows is `feedback.shortId` (epic #32). Nothing on the quest carries
 * the second, so it is read here, once, and shared: the key is the feedback
 * id, so the badge and the discussion event that both name the same item pay
 * for one request between them.
 *
 * ⚠️ Resolved in the browser rather than added to the quest response, and
 * that is the decision worth not re-litigating. A `feedbackShortId` on
 * `questResourceSchema` would have to be populated by every read that builds
 * a quest - `mapQuestToResource` has 36 call sites and is pure and
 * synchronous - and the ones that matter are not only the loaders: `QuestView`
 * replaces its quest with the response of every update it makes, so a field
 * that only the single-quest read resolved would be present when the page
 * opened and silently gone after the first edit.
 *
 * `reference` is undefined while the read is in flight, and stays undefined
 * when it fails. A failure is ordinary here: the item may be deleted, or the
 * reader's rank may not open the inbox (`feedback:read`), and a badge that
 * links somewhere they cannot go is worse than one that does not link.
 */
export const useFeedbackReference = (feedbackId?: number | null) => {
  const router = useRouter<AppRouter>();
  const feedbackApi = useClient<FeedbackController>();
  const [project] = useStore(currentProjectAtom);

  const { data } = useQuery(
    {
      enabled: Boolean(project && feedbackId != null),
      key: ["feedback-reference", project?.id, feedbackId],
      handler: async () => {
        if (!project || feedbackId == null) {
          return undefined;
        }
        return await feedbackApi.getFeedback({
          params: { projectId: project.id, feedbackId },
        });
      },
    },
    [project?.id, feedbackId],
  );

  if (!data || !project) {
    return { reference: undefined, href: undefined, shortId: undefined };
  }

  return {
    shortId: data.shortId,
    reference: formatReference("feedback", data.shortId),
    /**
     * The query, not a path segment: it is the address the wiki-link
     * rewriter already emits for `[[#P120]]`, and `ProjectFeedback` opens on
     * it whatever the item's status.
     */
    href: router.path("projectFeedback", {
      params: { projectSlug: project.slug },
      query: { feedback: String(data.shortId) },
    }),
  };
};
