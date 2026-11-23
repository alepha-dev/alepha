import {
  type ProjectMergeConflict,
  ProjectMergeService,
  type ProjectMergeTable,
  ProjectMergeTables,
} from "@lore/core/api";
import { $inject } from "alepha";
import { $repository } from "alepha/orm";

import { chatAgents } from "../entities/chatAgents.ts";
import { chatRooms } from "../entities/chatRooms.ts";

/**
 * Rooms move with a merged project (#E161). Members, messages and the rest
 * hang off a room, not a project, so they move with it.
 *
 * Both projects have a `general` and a name is unique per project: the
 * merged-in room takes the merge's own free name, `general (2)`, the rule
 * every renamed name follows (`ProjectMergeTables`).
 *
 * A project's agents (#E170) move too, deleted ones included, since past
 * answers point at them. Two live agents with one handle is a conflict that
 * refuses the merge: a handle is what people type, and renaming one to
 * `jarvis (2)` would leave a handle no message can mention. A deleted
 * agent has no handle and never collides.
 */
export class ChatRoomMerge {
  protected static readonly moved: ProjectMergeTable[] = [
    {
      kind: "chat room",
      entity: chatRooms,
      keys: ["name"],
      onCollision: "rename",
    },
    { kind: "chat agent", entity: chatAgents },
  ];

  protected readonly agents = $repository(chatAgents);

  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);

  constructor() {
    this.tables.prepare(ChatRoomMerge.moved);
    this.merge.registerStep({
      order: 40,
      name: "chat",
      tables: ["chat_rooms", "chat_agents"],
      plan: async (context) => {
        const result = await this.tables.move(context, ChatRoomMerge.moved[0]!);
        const agents = await this.tables.move(context, ChatRoomMerge.moved[1]!);
        return {
          moved: { chat_rooms: result.moved, chat_agents: agents.moved },
          renumbered: [],
          joined: [],
          changed: result.changed,
          conflicts: [
            ...result.conflicts,
            ...(await this.agentConflicts(
              context.sourceProjectId,
              context.targetProjectId,
            )),
          ],
          statements: [...result.statements, ...agents.statements],
        };
      },
    });
  }

  /**
   * The live handles both projects hold.
   */
  protected async agentConflicts(
    sourceProjectId: number,
    targetProjectId: number,
  ): Promise<ProjectMergeConflict[]> {
    const live = (projectId: number) =>
      this.agents.findMany({
        where: { projectId: { eq: projectId }, deletedAt: { isNull: true } },
        columns: ["id", "handle"],
      });
    const [source, target] = await Promise.all([
      live(sourceProjectId),
      live(targetProjectId),
    ]);
    const byHandle = new Map(target.map((it) => [it.handle, it.id]));
    return source.flatMap((it) => {
      const targetId = it.handle ? byHandle.get(it.handle) : undefined;
      return targetId
        ? [{ kind: "chat agent", key: it.handle!, sourceId: it.id, targetId }]
        : [];
    });
  }
}
