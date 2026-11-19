import { ResourceLinkService } from "@lore/core/api";
import type { ProjectRosterEntry } from "@lore/core/api";
import { $inject } from "alepha";

/**
 * What a message names (#E161, #Q3926): the members it mentions and the
 * resources it references.
 *
 * - `@handle` resolves against the people who can see the room, by the
 *   handle the roster gives them (`mentionHandle`). An unknown handle stays
 *   plain text, and so does a member outside the room: a mention cannot
 *   pull somebody into a private conversation.
 * - `[[#Q12]]` is core's reference grammar, read by `ResourceLinkService`;
 *   the bare `#Q12` a person types in a chat is accepted too, and becomes
 *   the same token.
 *
 * Code spans and fences are skipped, as the link graph skips them.
 */
export class ChatMentionParser {
  protected readonly links = $inject(ResourceLinkService);

  public parse(
    body: string,
    roster: ProjectRosterEntry[],
  ): { userIds: string[]; references: string[] } {
    const prose = this.withoutCode(body);

    const byHandle = new Map(
      roster.map((entry) => [entry.name.toLowerCase(), entry.userId]),
    );
    const userIds: string[] = [];
    for (const match of prose.matchAll(/(^|[^\w@])@([\w.-]+)/g)) {
      const handle = match[2]!.replace(/[.-]+$/, "").toLowerCase();
      const userId = byHandle.get(handle);
      if (userId && !userIds.includes(userId)) {
        userIds.push(userId);
      }
    }

    const references: string[] = [];
    const add = (raw: string) => {
      const token = this.links.parseToken(raw);
      if (!token) return;
      const key = raw.replace(/^#/, "").toUpperCase();
      if (!references.includes(key)) references.push(key);
    };
    for (const token of this.links.parseTokens(body)) {
      add(token.raw);
    }
    for (const match of prose.matchAll(/(^|[^\w[#])#([A-Za-z])(\d+)\b/g)) {
      add(`#${match[2]!.toUpperCase()}${match[3]}`);
    }

    return { userIds, references };
  }

  /**
   * The body with its code fences and spans blanked out.
   */
  protected withoutCode(body: string): string {
    return body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  }
}
