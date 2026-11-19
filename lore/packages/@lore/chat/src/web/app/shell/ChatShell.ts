import { ProjectShellRegistry } from "@lore/core/web";
import { $inject } from "alepha";
import { MessagesSquare } from "lucide-react";

/**
 * Chat's part of the project shell (#E161): one sidebar row.
 *
 * In the Activity group, after Activity (order 20), so it sits between
 * Activity and Quests as in the mockup: the groups are drawn in their band
 * order and each sorted by `order`. The row takes a `badge` once the live
 * quest gives it a count.
 */
export class ChatShell {
  protected readonly shell = $inject(ProjectShellRegistry);

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
      },
    ]);
  }
}
