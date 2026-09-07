import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

import { outsideProtected } from "../../web/app/components/project/quest/commentReferences.ts";
import { matchMentions } from "../../web/app/services/mentions.ts";
import { LoreInboxNotifications } from "../notifications/LoreInboxNotifications.ts";
import { ProjectRoster, type ProjectRosterEntry } from "./ProjectRoster.ts";

/**
 * What a mention points at, resolved by the caller.
 */
export interface MentionSubject {
  projectId: number;
  projectTitle: string;
  /**
   * The typed reference, already formatted: `#Q402`, `#P120`. Built through
   * `formatReference`, never by hand.
   */
  reference: string;
  /**
   * The quest's or feedback item's own title, for the second line.
   */
  title: string;
  /**
   * Where the message goes, relative to the app root.
   */
  href: string;
}

/**
 * Turns `@name` in a comment into a message in somebody's inbox.
 *
 * Its own service because two surfaces need it - quest comments and feedback
 * comments - and the rules below are the kind discovered by annoyance rather
 * than by review, so they belong in one place.
 *
 * ## The rules, and why each one exists
 *
 * - **Never ping the author.** Mentioning yourself is a note to self. The
 *   author is dropped from the roster before matching, so it cannot be
 *   reintroduced by a later change to the matcher.
 * - **One message per person per comment.** `@fabrice` three times in one
 *   body is one message; the matcher already dedupes.
 * - **Only project members.** The roster IS the member list, so an unknown
 *   handle matches nothing. A mention is not a way to reach somebody outside
 *   the project.
 * - **On edit, only the newly added handles.** Fixing a typo elsewhere in
 *   the body must not re-ping everyone, so the edit path diffs against the
 *   previous body rather than repeating the create path.
 *
 * ## ⚠️ A body with no `@` reads no roster at all
 *
 * The roster is a `members ⋈ users` join, and the great majority of comments
 * - MCP ones especially - contain no mention. One `String.includes` keeps
 * that join off the hot path of every comment in the app.
 *
 * ## ⚠️ Membership is checked at match time only
 *
 * The push happens in the request, the send happens in a job. Somebody who
 * leaves the project in between still receives the message. Accepted: the
 * alternative is re-checking membership inside the send path, which means
 * teaching the notification job what a Lore project is.
 */
export class MentionNotifier {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly roster = $inject(ProjectRoster);
  protected readonly templates = $inject(LoreInboxNotifications);

  /**
   * Ping everybody newly named in `body`, and nobody else.
   *
   * Never throws: a comment that saved must not fail because a message could
   * not be queued.
   */
  public async notify(options: {
    subject: MentionSubject;
    authorId: string;
    body: string;
    /**
     * The body before an edit. Absent on create, which is what makes every
     * matched handle new.
     */
    previousBody?: string;
  }): Promise<void> {
    try {
      // The cheap gate, before any query. See the class docstring.
      if (!options.body.includes("@")) return;

      const roster = await this.roster.of(options.subject.projectId);
      const author = roster.find((it) => it.userId === options.authorId);
      // The author is dropped here rather than after matching, so it cannot
      // be reintroduced by a later change to the matcher.
      const recipients = roster.filter(
        (it) => it.userId !== options.authorId && it.email,
      );
      if (recipients.length === 0) return;

      const now = this.mentioned(options.body, recipients);
      const before = options.previousBody
        ? this.mentioned(options.previousBody, recipients)
        : [];
      const added = now.filter(
        (it) => !before.some((was) => was.userId === it.userId),
      );

      for (const recipient of added) {
        await this.push(options.subject, author, recipient, options.body);
      }
    } catch (error) {
      this.log.error("Failed to deliver mentions for a comment", {
        projectId: options.subject.projectId,
        reference: options.subject.reference,
        error,
      });
    }
  }

  /**
   * Everybody named in one body.
   *
   * ⚠️ `outsideProtected` is not optional. It holds out fenced blocks,
   * inline code spans, existing `[[...]]` and markdown link targets, which
   * is the same set the renderer holds out - so a comment explaining an
   * `@decorator` in a code span links nobody and pings nobody.
   */
  protected mentioned(
    body: string,
    recipients: ProjectRosterEntry[],
  ): ProjectRosterEntry[] {
    const found: ProjectRosterEntry[] = [];
    outsideProtected(body, (segment) => {
      for (const member of matchMentions(segment, recipients)) {
        if (!found.includes(member)) found.push(member);
      }
      return segment;
    });
    return found;
  }

  protected async push(
    subject: MentionSubject,
    author: ProjectRosterEntry | undefined,
    recipient: ProjectRosterEntry,
    body: string,
  ): Promise<void> {
    const baseUrl = this.alepha.env.PUBLIC_URL ?? "";

    await this.templates.inboxMention.push({
      contact: recipient.email,
      // ⚠️ Explicit, never inferred. `$notification` resolves the language
      // from the current request, which belongs to the AUTHOR, and `users`
      // carries no language column - so a French author would mail an
      // English colleague in French. See the templates' own docstring.
      lang: "en",
      variables: {
        reference: subject.reference,
        subjectTitle: subject.title,
        authorName: author?.name || "Someone",
        excerpt: this.excerpt(body),
        projectTitle: subject.projectTitle,
        href: subject.href,
        url: `${baseUrl}${subject.href}`,
        // Opaque, and the framework never parses it.
        scope: `project:${subject.projectId}`,
      },
    });
  }

  /**
   * A short plain-text lead-in for the email body.
   *
   * Truncated rather than rendered: the email escapes it, and a mail client
   * is not the place to discover that a comment was four screens of
   * markdown.
   */
  protected excerpt(body: string, max = 280): string {
    const flat = body.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  }
}
