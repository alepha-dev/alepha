import { LoreInboxNotifications, ProjectRoster } from "@lore/core/api";
import { projects } from "@lore/core/schemas";
import { $hook, $inject, Alepha } from "alepha";
import { NotificationInboxService } from "alepha/api/notifications";
import { BackgroundTaskProvider } from "alepha/background";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import type { ChatMessage } from "../entities/chatMessages.ts";
import type { ChatRoom } from "../entities/chatRooms.ts";
import { ChatRoomService } from "./ChatRoomService.ts";

/**
 * A mention in a room reaches the member who is away (#E161, #Q3931): a
 * direct inbox item, and an email by their own settings, through the same
 * `inboxMention` template a quest comment uses.
 *
 * Never a project event. That route sends to every subscriber of the event
 * and posts to the project's channels with no member to check, so a private
 * room's text would leave the room. A direct item is addressed to one
 * member, and a mention only ever names someone who can see the room
 * (`ChatMentionParser` resolves against the room's audience).
 *
 * - **Not to the reader in the room.** Sent after {@link GRACE_MS}: a member
 *   who has the room open has read past the message by then (the page marks
 *   it read as it arrives), and is skipped.
 * - **Not from a muted room.**
 * - **Once per message.** An edit passes only the members it newly names.
 */
export class ChatMentionNotifier {
  /**
   * How long a member has to read a mention on the page before they are
   * notified of it.
   */
  public static readonly GRACE_MS = 5000;

  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly templates = $inject(LoreInboxNotifications);
  protected readonly roster = $inject(ProjectRoster);
  protected readonly rooms = $inject(ChatRoomService);
  protected readonly projects = $repository(projects);
  protected readonly background = $inject(BackgroundTaskProvider);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly inbox = $inject(NotificationInboxService);
  protected readonly stopping = new AbortController();

  protected readonly onStop = $hook({
    on: "stop",
    priority: "first",
    handler: () => this.stopping.abort(),
  });

  public notify(
    room: ChatRoom,
    message: ChatMessage,
    authorId: string,
    mentioned: string[],
  ): void {
    const recipients = mentioned.filter((id) => id !== authorId);
    if (recipients.length === 0) return;
    this.background.defer(async () => {
      try {
        await this.dateTime.wait(this.grace(), {
          signal: this.stopping.signal,
        });
      } catch {
        // The app is stopping: a mention not yet sent is dropped rather
        // than holding the shutdown for the rest of its grace.
        return;
      }
      await this.send(room, message, authorId, recipients);
    });
  }

  /**
   * The wait before a notification; a spec shortens it.
   */
  protected grace(): number {
    return ChatMentionNotifier.GRACE_MS;
  }

  protected async send(
    room: ChatRoom,
    message: ChatMessage,
    authorId: string,
    recipients: string[],
  ): Promise<void> {
    const project = await this.projects.findById(room.projectId);
    if (!project) return;
    const roster = await this.roster.of(room.projectId);
    const author = roster.find((it) => it.userId === authorId);
    const href = this.hrefOf(project.slug, room);
    const baseUrl = this.alepha.env.PUBLIC_URL ?? "";

    for (const userId of recipients) {
      const membership = await this.rooms.membershipOf(room.id, userId);
      if (membership?.notifyLevel === "muted") continue;
      if (
        membership?.lastReadMessageId &&
        membership.lastReadMessageId >= message.id
      ) {
        continue;
      }
      const recipient = roster.find((it) => it.userId === userId);
      if (!recipient?.email) continue;
      try {
        await this.templates.inboxMention.push({
          contact: recipient.email,
          lang: this.templates.lang,
          variables: {
            reference: `#${room.name}`,
            subjectTitle: room.name,
            authorName: author?.label || author?.name || "",
            agent: false,
            excerpt: this.excerpt(message.body),
            projectTitle: project.title,
            href,
            url: `${baseUrl}${href}`,
            scope: `project:${room.projectId}`,
          },
        });
      } catch (error) {
        this.log.warn("A chat mention was not notified", { userId, error });
      }
    }
  }

  /**
   * A member who read the room has read its mentions of them (#Q4191): their
   * inbox items pointing at the room are marked read, so the dock's badge,
   * which counts them, drops with the room's own unread.
   */
  public async markRead(room: ChatRoom, userId: string): Promise<number> {
    const project = await this.projects.findById(room.projectId);
    if (!project) return 0;
    return this.inbox.markReadByHref(userId, this.hrefOf(project.slug, room), {
      scope: `project:${room.projectId}`,
    });
  }

  protected hrefOf(projectSlug: string | undefined, room: ChatRoom): string {
    return `/${projectSlug}/chat/${room.name}`;
  }

  protected excerpt(body: string, max = 280): string {
    const flat = body.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  }
}
