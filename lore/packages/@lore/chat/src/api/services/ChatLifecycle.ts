import { ProjectDeletionService } from "@lore/core/api";
import { $hook, $inject } from "alepha";
import { FileService } from "alepha/api/files";
import { $repository } from "alepha/orm";

import { chatAgents } from "../entities/chatAgents.ts";
import { chatMentions } from "../entities/chatMentions.ts";
import { chatMessages } from "../entities/chatMessages.ts";
import { chatReactions } from "../entities/chatReactions.ts";
import { chatRoomMembers } from "../entities/chatRoomMembers.ts";
import { chatRooms } from "../entities/chatRooms.ts";
import { ChatBuckets } from "./ChatBuckets.ts";

/**
 * What happens to chat when a project or an account goes (#E161, #Q3954).
 * A merge is {@link ChatRoomMerge}'s.
 *
 * ## Project deletion
 *
 * One step, children first, each a delete by the room it hangs off:
 * mentions, members and messages, then the rooms, then the agents. No CASCADE is relied on
 * and no transaction is needed: a step that stops half way leaves fewer
 * rows, and running it again removes the rest.
 *
 * ## Account deletion
 *
 * A deleted account's messages keep their row and lose their author, so a
 * conversation does not lose its middle; the page shows them as a removed
 * member. Its memberships and mentions go. The foreign keys' `set null`
 * and `cascade` say the same; it is written out here too because no Lore
 * cleanup relies on a cascade alone.
 *
 * ## Retention
 *
 * Messages are kept for as long as their room (folio #F1528): a chat that
 * forgets is a surprise. No purge job runs.
 */
export class ChatLifecycle {
  protected readonly deletion = $inject(ProjectDeletionService);
  protected readonly rooms = $repository(chatRooms);
  protected readonly members = $repository(chatRoomMembers);
  protected readonly messages = $repository(chatMessages);
  protected readonly mentions = $repository(chatMentions);
  protected readonly reactions = $repository(chatReactions);
  protected readonly files = $inject(FileService);
  protected readonly agents = $repository(chatAgents);

  constructor() {
    this.deletion.registerStep({
      order: 40,
      run: async (projectId) => this.deleteProject(projectId),
    });
  }

  /**
   * Runs after core's own handler on the same event, which refuses the
   * deletion of an account that still owns an organization: that refusal is
   * registered first, so nothing here runs for an account that stays.
   */
  protected readonly onUserDelete = $hook({
    on: "user:delete:before",
    handler: async ({ userId }) => this.deleteAccount(userId),
  });

  public async deleteProject(projectId: number): Promise<void> {
    const rooms = await this.rooms.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["id"],
    });
    const roomIds = rooms.map((room) => room.id);
    if (roomIds.length > 0) {
      // The files first: once the messages are gone nothing lists them.
      const carrying = await this.messages.findMany({
        where: { roomId: { inArray: roomIds } },
        columns: ["attachments"],
      });
      const fileIds = carrying.flatMap((it) => it.attachments ?? []);
      if (fileIds.length > 0) {
        await this.files.deleteFiles(fileIds, {
          bucket: ChatBuckets.ATTACHMENT_BUCKET,
        });
      }
      await this.reactions.deleteMany({ roomId: { inArray: roomIds } });
      await this.mentions.deleteMany({ roomId: { inArray: roomIds } });
      await this.members.deleteMany({ roomId: { inArray: roomIds } });
      await this.messages.deleteMany({ roomId: { inArray: roomIds } });
    }
    await this.rooms.deleteMany({ projectId: { eq: projectId } });
    // The project's agents (#E170), deleted ones included, and their
    // pictures.
    const agents = await this.agents.findMany({
      where: { projectId: { eq: projectId } },
      columns: ["avatar"],
    });
    const avatars = agents.flatMap((it) => (it.avatar ? [it.avatar] : []));
    if (avatars.length > 0) {
      await this.files.deleteFiles(avatars, {
        bucket: ChatBuckets.AGENT_AVATAR_BUCKET,
      });
    }
    await this.agents.deleteMany({ projectId: { eq: projectId } });
  }

  public async deleteAccount(userId: string): Promise<void> {
    await this.mentions.deleteMany({ userId: { eq: userId } });
    await this.reactions.deleteMany({ userId: { eq: userId } });
    await this.members.deleteMany({ userId: { eq: userId } });
    await this.messages.updateMany(
      { authorId: { eq: userId } },
      { authorId: null },
    );
    await this.rooms.updateMany(
      { createdBy: { eq: userId } },
      { createdBy: null },
    );
    await this.agents.updateMany(
      { createdBy: { eq: userId } },
      { createdBy: null },
    );
  }
}
