import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type {
  AgentPromptItemSubject,
  AgentPromptProjectSubject,
} from "../../../prompts/renderPromptTemplate.ts";
import {
  formatReference,
  type ReferenceKind,
} from "../../shared/element/typedReference.ts";

/**
 * Where a prompt's seven fields are assembled, for every surface. Core and
 * kind-blind (#E75, #Q2624): a module names its item through `forItem`
 * (Work's `useWorkPromptSubject`), or a page of its own through `forPage`.
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
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);

  /**
   * Absolute where there is a window, a path otherwise. A path is the honest
   * answer on the server rather than an origin invented there.
   */
  const absolute = (path: string): string =>
    typeof window === "undefined" ? path : `${window.location.origin}${path}`;

  return {
    forItem: (item: AgentPromptItem): AgentPromptItemSubject => ({
      project: project?.title ?? "",
      slug: project?.slug ?? "",
      number: item.number,
      id: item.id,
      reference: formatReference(item.kind, item.number),
      title: item.title,
      url: absolute(
        router.path(
          item.route as never,
          {
            params: item.params,
            query: item.query,
          } as never,
        ),
      ),
    }),

    forPage: (route: string): AgentPromptProjectSubject => ({
      project: project?.title ?? "",
      slug: project?.slug ?? "",
      url: absolute(router.path(route as never)),
    }),
  };
};

/**
 * One item a prompt hands over: its reference, title, and the page it lives
 * at.
 */
export interface AgentPromptItem {
  kind: ReferenceKind;
  number: number;
  id: AgentPromptItemSubject["id"];
  title: string;
  route: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}
