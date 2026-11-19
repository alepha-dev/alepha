import {
  ProjectMergeService,
  type ProjectMergeTable,
  ProjectMergeTables,
} from "@lore/core/api";
import { $inject } from "alepha";

import { chatRooms } from "../entities/chatRooms.ts";

/**
 * Rooms move with a merged project (#E161). Members, messages and the rest
 * hang off a room, not a project, so they move with it.
 *
 * Both projects have a `general` and a name is unique per project: the
 * merged-in room takes the merge's own free name, `general (2)`, the rule
 * every renamed name follows (`ProjectMergeTables`).
 */
export class ChatRoomMerge {
  protected static readonly moved: ProjectMergeTable[] = [
    {
      kind: "chat room",
      entity: chatRooms,
      keys: ["name"],
      onCollision: "rename",
    },
  ];

  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);

  constructor() {
    this.tables.prepare(ChatRoomMerge.moved);
    this.merge.registerStep({
      order: 40,
      name: "chat",
      tables: ["chat_rooms"],
      plan: async (context) => {
        const result = await this.tables.move(context, ChatRoomMerge.moved[0]!);
        return {
          moved: { chat_rooms: result.moved },
          renumbered: [],
          joined: [],
          changed: result.changed,
          conflicts: result.conflicts,
          statements: result.statements,
        };
      },
    });
  }
}
