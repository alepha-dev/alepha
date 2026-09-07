import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";

import type { EpicResource } from "@/api/schemas/epicResourceSchema.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import type { AgentPromptSubject } from "@/web/app/prompts/renderPromptTemplate.ts";

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
    forEpic: (epic: EpicResource): AgentPromptSubject => ({
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
  };
};
