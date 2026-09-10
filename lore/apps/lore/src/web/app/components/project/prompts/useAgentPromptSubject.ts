import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { FeedbackResource } from "@/api/schemas/feedbackResourceSchema.ts";
import type { QuestResource } from "@/api/schemas/questResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type {
  AgentPromptItemSubject,
  AgentPromptProjectSubject,
} from "@/web/app/prompts/renderPromptTemplate.ts";

import { formatReference } from "../../shared/element/typedReference.ts";

/**
 * Where a prompt's seven fields are assembled, for every surface.
 *
 * ⚠️ **One place, on purpose.** The fields are copied out of a resource one
 * by one rather than the resource being handed over, because this text goes
 * to the clipboard and lands wherever the reader pastes it: a sigil key, a
 * token or a reporter's email must have no path into it. Assembling it in
 * five call sites would be five chances for one of them to spread a resource
 * in "just this once".
 *
 * ⚠️ `{{project}}` is the project's TITLE and `{{slug}}` its URL slug, and
 * the two are not interchangeable: `project_name` over MCP matches
 * `projects.title` lowercased and never the slug.
 */
export const useAgentPromptSubject = () => {
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);

  /**
   * Absolute where there is a window, a path otherwise. A path is the honest
   * answer on the server rather than an origin invented there.
   */
  const absolute = (path: string): string =>
    typeof window === "undefined" ? path : `${window.location.origin}${path}`;

  return {
    forEpic: (epic: EpicResource): AgentPromptItemSubject => ({
      project: project?.title ?? "",
      slug: project?.slug ?? "",
      number: epic.number,
      // The GLOBAL id, which is what `quest_list`'s `epic:` filter takes.
      id: epic.id,
      reference: formatReference("epic", epic.number),
      title: epic.title,
      url: absolute(
        router.path("projectEpic", {
          params: { epicNumber: String(epic.number) },
        }),
      ),
    }),

    forQuest: (quest: QuestResource): AgentPromptItemSubject => ({
      project: project?.title ?? "",
      slug: project?.slug ?? "",
      // ⚠️ The two differ, and the prompt uses both: `quest_get` takes the
      // per-project `shortId`, and a global id handed to it finds another
      // project's quest or nothing.
      number: quest.shortId,
      id: quest.id,
      reference: formatReference("quest", quest.shortId),
      title: quest.title,
      url: absolute(
        router.path("projectQuest", {
          params: { shortId: String(quest.shortId) },
        }),
      ),
    }),

    /**
     * ⚠️ The surface where copying field by field earns its keep. A
     * feedback resource carries the reporter's identity, `context` with the
     * page and user agent they reported from, and their attachments. None
     * of that belongs on a clipboard, and the only thing keeping it off is
     * that this builds seven fields rather than spreading a resource.
     */
    forFeedback: (feedback: FeedbackResource): AgentPromptItemSubject => ({
      project: project?.title ?? "",
      slug: project?.slug ?? "",
      number: feedback.shortId,
      id: feedback.id,
      // ⚠️ `#P`, not `#F`. `F` is the folio's letter; feedback kept `P`
      // from Petitions. Never build this string by hand.
      reference: formatReference("feedback", feedback.shortId),
      title: feedback.title,
      // The ITEM, since #Q2077: `projectFeedback` honours
      // `?feedback=<shortId>` and opens that report whatever its status,
      // which is the case that matters here - a promoted item is `accepted`
      // and the inbox opens on `pending`. It was the bare inbox before, and
      // the prompt said so, because the selection was React state alone.
      url: absolute(
        router.path("projectFeedback", {
          query: { feedback: String(feedback.shortId) },
        }),
      ),
    }),

    /**
     * The feedback INBOX, for a prompt about the surface rather than one
     * item.
     *
     * ⚠️ Three fields, and the four item-scoped ones are absent rather than
     * blank. A loop has nothing to number, and `AgentPromptProjectSubject`
     * is the type that says so - see `renderPromptTemplate`, which leaves a
     * placeholder it cannot answer verbatim instead of writing `#P0` and an
     * empty title onto somebody's clipboard.
     */
    forFeedbackInbox: (): AgentPromptProjectSubject => ({
      project: project?.title ?? "",
      slug: project?.slug ?? "",
      url: absolute(router.path("projectFeedback")),
    }),

    /**
     * The blights inbox. Surface-scoped for the same reason the feedback
     * inbox is: a triage loop has no item to number.
     */
    forBlightsInbox: (): AgentPromptProjectSubject => ({
      project: project?.title ?? "",
      slug: project?.slug ?? "",
      url: absolute(router.path("projectBlights")),
    }),
  };
};
