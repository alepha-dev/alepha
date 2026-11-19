import { hasCapability, ProjectLoaderRegistry } from "@lore/core/web";
import { $inject, Alepha } from "alepha";

import { chatUnreadAtom } from "../atoms/chatUnreadAtom.ts";
import { ChatUnread } from "../services/ChatUnread.ts";

/**
 * Chat's part of opening a project (#E161, #Q3940): the badge's first
 * count. The live feed keeps it current afterwards.
 */
export class ChatProjectLoader {
  protected readonly alepha = $inject(Alepha);
  protected readonly loaders = $inject(ProjectLoaderRegistry);
  protected readonly unread = $inject(ChatUnread);

  constructor() {
    this.loaders.register({
      key: "chat",
      order: 50,
      load: async (project) => {
        const counts = hasCapability(project, "chat")
          ? await this.unread.fetch(project.id)
          : undefined;
        return () => {
          this.alepha.store.set(
            chatUnreadAtom,
            counts ?? { projectId: project.id, total: 0, mentions: 0 },
          );
        };
      },
      leave: () => {
        this.alepha.store.set(chatUnreadAtom, {
          projectId: 0,
          total: 0,
          mentions: 0,
        });
      },
    });
  }
}
