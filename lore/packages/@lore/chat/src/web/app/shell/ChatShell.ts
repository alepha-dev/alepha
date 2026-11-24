import { ProjectShellRegistry, ShellExtensionRegistry } from "@lore/core/web";
import { $inject } from "alepha";
import { MessagesSquare } from "lucide-react";

import { chatUnreadAtom } from "../atoms/chatUnreadAtom.ts";
import ChatLiveFeed from "../components/ChatLiveFeed.tsx";

/**
 * Chat's part of the project shell (#E161): one sidebar row, with the
 * reader's unread count as its badge, and the live feed mounted once at
 * the layout's root, which keeps that count moving on any page (#Q3940).
 *
 * In the Activity group, after Activity (order 20), so it sits between
 * Activity and Quests as in the mockup.
 */
export class ChatShell {
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly extensions = $inject(ShellExtensionRegistry);

  constructor() {
    this.shell.registerNav("chat", [
      {
        route: "projectChat",
        permission: "chat:read",
        labelKey: "project.menu.chat",
        icon: MessagesSquare,
        group: "activity",
        order: 30,
        activeOn: (name) => name.startsWith("projectChat"),
        reads: [chatUnreadAtom],
        // Muted rooms are left out; `@` marks a count that mentions the
        // reader.
        badge: (context) => {
          const unread = context.get(chatUnreadAtom);
          if (!unread?.total) return undefined;
          return unread.mentions > 0 ? `@${unread.total}` : unread.total;
        },
      },
    ]);
    // The project's agents (#E170) sit beside its people, as Settings >
    // Members' Agents tab (#Q4260), while chat is on.
    this.shell.registerSettingsTab("members", {
      route: "projectSettingsChatAgents",
      labelKey: "project.settings.tab.chatAgents",
      capability: "chat",
      requires: "chat:read",
    });
    this.extensions.registerOverlay({
      key: "chat-live",
      component: ChatLiveFeed,
    });
  }
}
