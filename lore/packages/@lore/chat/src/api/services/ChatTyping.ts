import { ProjectSecurityService } from "@lore/core/api";
import { $inject } from "alepha";
import { $rateLimit } from "alepha/rate-limit";

import type { ChatClientFrame } from "../schemas/chatClientFrameSchema.ts";
import { ChatAudience } from "./ChatAudience.ts";
import { ChatLive } from "./ChatLive.ts";
import { ChatRoomService } from "./ChatRoomService.ts";

/**
 * "Is typing" (#E161, #Q3940): a frame a member's page sends, relayed to
 * the room's other readers, never stored.
 *
 * Relayed only for a room the sender may write in, and never back to the
 * sender: on Workers this runs in the sender's own Durable Object, which
 * must not call its own stub. Pages send it at most every few seconds; the
 * limit here only stops a page that does not.
 */
export class ChatTyping {
  protected readonly rooms = $inject(ChatRoomService);
  protected readonly audience = $inject(ChatAudience);
  protected readonly live = $inject(ChatLive);
  protected readonly security = $inject(ProjectSecurityService);

  protected readonly limit = $rateLimit({
    name: "chat:typing",
    limit: 30,
    window: [1, "minute"],
    key: (userId: string) => userId,
  });

  public async relay(userId: string, frame: ChatClientFrame): Promise<void> {
    if (frame.type !== "typing") return;
    if (!(await this.limit.consume(userId)).allowed) return;
    if (!(await this.security.holds(frame.projectId, userId, "chat:write"))) {
      return;
    }
    const room = await this.rooms
      .visibleRoom(frame.projectId, frame.roomId, userId)
      .catch(() => undefined);
    if (!room || room.archivedAt) return;
    const others = (await this.audience.of(room)).filter((id) => id !== userId);
    await this.live.send(others, {
      type: "typing",
      projectId: frame.projectId,
      roomId: room.id,
      userId,
    });
  }
}
