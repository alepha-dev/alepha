import {
  $pageProject,
  $pageProjectSettings,
  canInProject,
  currentProjectAtom,
  hasCapability,
} from "@lore/core/web";
import { $inject, Alepha, z } from "alepha";
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
    loader: async () => this.gate(),
  });

  /**
   * One room, by its name: `/<project>/chat/<room>`, so a room can be
   * linked. The same page: it reads the name from the route.
   */
  projectChatRoom = $pageProject({
    name: "projectChatRoom",
    path: "/chat/:room",
    schema: { params: z.object({ room: z.text() }) },
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Chat`,
    }),
    lazy: () => import("./components/ChatPage.tsx"),
    loader: async () => this.gate(),
  });

  /**
   * Settings > Members > Agents (#E170, #Q4199, moved by #Q4260): the
   * project's chat agents. Listed while chat is on, to every rank that reads
   * it; writing them is `chat:agent`, which the page and the server both
   * check.
   */
  projectSettingsChatAgents = $pageProjectSettings({
    name: "projectSettingsChatAgents",
    path: "/members/agents",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Chat agents`,
    }),
    lazy: () => import("./components/settings/ChatAgentsSettingsPage.tsx"),
  });

  /**
   * What both pages require: the project, its chat capability, and a rank
   * that reads chat.
   */
  protected gate() {
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
  }
}
