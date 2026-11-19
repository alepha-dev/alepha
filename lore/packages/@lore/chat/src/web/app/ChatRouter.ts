import {
  $pageProject,
  canInProject,
  currentProjectAtom,
  hasCapability,
} from "@lore/core/web";
import { $inject, Alepha } from "alepha";
import { NotFoundError } from "alepha/server";

/**
 * Chat's pages (#E161). Each mounts under core's project layout with
 * `$pageProject`, so no router names another module's page.
 */
export class ChatRouter {
  alepha = $inject(Alepha);

  projectChat = $pageProject({
    name: "projectChat",
    path: "/chat",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Chat`,
    }),
    lazy: () => import("./components/ChatPage.tsx"),
    loader: async () => {
      const project = this.alepha.store.get(currentProjectAtom);
      if (!project) {
        throw new NotFoundError("Project not found");
      }
      // 404, never 403: a page the reader may not open does not exist for
      // them, the same rule the other modules' pages follow.
      if (!hasCapability(project, "chat")) {
        throw new NotFoundError("Chat is not enabled for this project");
      }
      if (!canInProject(project, "chat:read")) {
        throw new NotFoundError("Your rank does not open chat here");
      }
      return {};
    },
  });
}
