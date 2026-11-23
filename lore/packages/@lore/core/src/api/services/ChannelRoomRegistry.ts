import { $inject, Alepha, AlephaError } from "alepha";

import { ProjectChannelService } from "./ProjectChannelService.ts";

/**
 * Chat rooms as a notification channel (#Q4052). Notifications are core's
 * and rooms are `@lore/chat`'s, which core may not import, so they meet
 * here, on {@link CommitReferenceRegistry}'s pattern:
 *
 * - **Chat registers the provider**: which rooms a channel may post into,
 *   and the post itself, written as the Lore agent.
 * - **Core calls it** when a channel of kind `chat` is added, listed, or
 *   delivers an event.
 *
 * Without Chat no room is offered and a room channel delivers nothing.
 */
export class ChannelRoomRegistry {
  protected readonly alepha = $inject(Alepha);
  protected provider?: ChannelRoomProvider;

  public register(provider: ChannelRoomProvider): void {
    if (this.provider) {
      throw new AlephaError("A channel room provider is already registered");
    }
    this.provider = provider;
  }

  /**
   * The project's rooms a channel may post into: open and not archived.
   */
  public async rooms(projectId: number): Promise<ChannelRoom[]> {
    return this.provider ? this.provider.rooms(projectId) : [];
  }

  /**
   * Post a message into a room, as Lore. False when the room is gone,
   * archived or private, or Chat is not loaded: the event is then not
   * delivered, and the channel says why.
   */
  public async post(
    projectId: number,
    roomId: string,
    body: string,
  ): Promise<boolean> {
    return this.provider ? this.provider.post(projectId, roomId, body) : false;
  }

  /**
   * Chat tells core a room was renamed (#Q4187), so a channel named after it
   * follows.
   */
  public async renamed(
    projectId: number,
    roomId: string,
    from: string,
    to: string,
  ): Promise<void> {
    // Resolved here, not as a field: the channel service injects this
    // registry.
    await this.alepha
      .inject(ProjectChannelService)
      .roomRenamed(projectId, roomId, from, to);
  }
}

export interface ChannelRoom {
  id: string;
  name: string;
}

export interface ChannelRoomProvider {
  rooms: (projectId: number) => Promise<ChannelRoom[]>;
  post: (projectId: number, roomId: string, body: string) => Promise<boolean>;
}
