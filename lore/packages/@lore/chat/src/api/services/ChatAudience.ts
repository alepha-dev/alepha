import { ProjectSecurityService } from "@lore/core/api";
import { $inject, Alepha } from "alepha";
import { RankService } from "alepha/api/organizations";
import { $repository } from "alepha/orm";

import { chatRoomMembers } from "../entities/chatRoomMembers.ts";
import type { ChatRoom } from "../entities/chatRooms.ts";

/**
 * Who may see a room right now (#E161): the recipients of its frames, its
 * mentions and its notifications.
 *
 * - a private room: its members, if they still read chat in the project;
 * - an open room: every project member whose rank grants `chat:read`.
 *
 * Read from the database on every call, never cached: a member removed a
 * moment ago must not receive the next frame.
 */
export class ChatAudience {
  protected readonly alepha = $inject(Alepha);
  protected readonly security = $inject(ProjectSecurityService);
  protected readonly roomMembers = $repository(chatRoomMembers);

  public async of(room: ChatRoom): Promise<string[]> {
    const readers = await this.readers(room.projectId);
    if (!room.private) {
      return readers;
    }
    const members = await this.roomMembers.findMany({
      where: { roomId: { eq: room.id } },
      columns: ["userId"],
    });
    const allowed = new Set(readers);
    return members.map((it) => it.userId).filter((id) => allowed.has(id));
  }

  /**
   * Every member of the project whose rank grants `chat:read`: one read of
   * the membership rows, then one rank lookup per distinct rank.
   */
  public async readers(projectId: number): Promise<string[]> {
    const organizationId = await this.security.organizationIdOf(projectId);
    const members = await this.security.members.findMany({
      where: { organizationId: { eq: organizationId } },
      columns: ["userId", "rank"],
    });
    const ranks = this.alepha.inject(RankService);
    const grants = new Map<string, boolean>();
    const readers: string[] = [];
    for (const member of members) {
      const rank = member.rank ?? "member";
      let reads = grants.get(rank);
      if (reads === undefined) {
        const permissions =
          (await ranks.permissionsOf(organizationId, rank)) ?? [];
        reads = ranks.grants(permissions, "chat:read");
        grants.set(rank, reads);
      }
      if (reads) {
        readers.push(member.userId);
      }
    }
    return readers;
  }
}
