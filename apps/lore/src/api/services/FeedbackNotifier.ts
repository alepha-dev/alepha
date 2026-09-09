import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";

import { formatReference } from "../../web/app/components/shared/element/typedReference.ts";
import { projects } from "../entities/projects.ts";
import { users } from "../entities/users.ts";
import { LoreInboxNotifications } from "../notifications/LoreInboxNotifications.ts";

/**
 * The feedback item a message is about, as its callers already hold it.
 */
export interface FeedbackNotifierSubject {
  shortId: number;
  projectId: number;
  title: string;
  reporterUserId?: string;
}

/**
 * Tells the person who wrote a report what happened to it.
 *
 * Before this, nothing did. `MentionNotifier` reaches somebody whose `@name`
 * appears in a comment AND who is a project member; a reporter is usually
 * neither. They submitted through `/:projectSlug/request`, which asks for a
 * Lore account and not for membership, so accept, reject and answer all
 * happened in silence and the only way to learn about any of them was to go
 * back and look (feedback #P2165).
 *
 * ## Its own service, rather than two blocks in two controllers
 *
 * Resolving a reporter is the same six lines either way - the user row for
 * the address, the project row for the title and the slug, the reference, the
 * absolute URL - and the rules below are the part worth having in one place
 * and one spec. It is the shape `MentionNotifier` already has, for the same
 * reason.
 *
 * ## The rules, and why each one exists
 *
 * - **Never tell somebody about their own action.** The owner is very often
 *   also the reporter on their own project - every item in the batch that
 *   prompted this was - and a decision you took is not news.
 * - **One message, never two.** A comment that both answers a report and
 *   `@mentions` its author would otherwise send a mention and an answer. The
 *   comment path passes what `MentionNotifier` already reached, and this
 *   stands down for those.
 * - **An explicit `lang`, never the request's.** `$notification` resolves the
 *   language from the CURRENT request, which belongs to the OWNER doing the
 *   triage. A French owner rejecting an English reporter's item must not mail
 *   them French. See {@link LoreInboxNotifications.lang}.
 * - **Never throws.** A triage decision that saved must not fail because a
 *   message could not be queued.
 *
 * ## An anonymous report reaches nobody
 *
 * `feedback.reporterUserId` is optional, and a row without one is a report
 * whose author Lore cannot name. Nothing is sent, and nothing is logged as an
 * error: it is a supported state, not a failure.
 */
export class FeedbackNotifier {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly templates = $inject(LoreInboxNotifications);
  protected readonly users = $repository(users);
  protected readonly projects = $repository(projects);

  /**
   * The project accepted or rejected a report.
   */
  public async triaged(options: {
    feedback: FeedbackNotifierSubject;
    outcome: "accepted" | "rejected";
    /**
     * Who decided. Silences the message when they are also the reporter.
     */
    actorId: string;
  }): Promise<void> {
    try {
      const target = await this.reporterOf(options.feedback, options.actorId);
      if (!target) return;

      await this.templates.inboxFeedbackTriaged.push({
        contact: target.email,
        lang: this.templates.lang,
        variables: {
          ...target.subject,
          outcome: options.outcome,
        },
      });
    } catch (error) {
      this.log.error("Failed to tell a reporter their report was triaged", {
        projectId: options.feedback.projectId,
        shortId: options.feedback.shortId,
        error,
      });
    }
  }

  /**
   * Somebody answered a report.
   */
  public async commented(options: {
    feedback: FeedbackNotifierSubject;
    /**
     * Who wrote the comment. Silences the message when they are the reporter.
     */
    authorId: string;
    authorName: string;
    body: string;
    /**
     * User ids `MentionNotifier` has already written to for this comment.
     * The reporter being among them is the double-send this prevents.
     */
    alreadyNotified?: string[];
  }): Promise<void> {
    try {
      const reporterId = options.feedback.reporterUserId;
      if (reporterId && options.alreadyNotified?.includes(reporterId)) return;

      const target = await this.reporterOf(options.feedback, options.authorId);
      if (!target) return;

      await this.templates.inboxFeedbackComment.push({
        contact: target.email,
        lang: this.templates.lang,
        variables: {
          ...target.subject,
          authorName: options.authorName || "Someone",
          excerpt: this.excerpt(options.body),
        },
      });
    } catch (error) {
      this.log.error("Failed to tell a reporter their report was answered", {
        projectId: options.feedback.projectId,
        shortId: options.feedback.shortId,
        error,
      });
    }
  }

  /**
   * The reporter's address and the variables every template here shares, or
   * undefined when there is nobody to write to.
   */
  protected async reporterOf(
    feedback: FeedbackNotifierSubject,
    actorId: string,
  ): Promise<
    | undefined
    | {
        email: string;
        subject: {
          reference: string;
          feedbackTitle: string;
          projectTitle: string;
          href: string;
          url: string;
          scope: string;
        };
      }
  > {
    const reporterId = feedback.reporterUserId;
    // An anonymous report, or the actor's own. Both are supported states.
    if (!reporterId || reporterId === actorId) return undefined;

    const reporter = await this.users.findById(reporterId);
    if (!reporter?.email) return undefined;

    const project = await this.projects.findById(feedback.projectId);
    // ⚠️ `P`, not `F`, which is a folio. Through `formatReference` so the
    // grammar of epic #E32 has one implementation.
    const reference = formatReference("feedback", feedback.shortId);
    // The reporter's own view of it, not the owner's inbox: `/account/feedback`
    // is the page a reporter can reach whether or not they are a member, and
    // the project's triage inbox 403s for somebody who is not.
    const href = "/account/feedback";
    const baseUrl = this.alepha.env.PUBLIC_URL ?? "";

    return {
      email: reporter.email,
      subject: {
        reference,
        feedbackTitle: feedback.title,
        projectTitle: project?.title ?? "",
        href,
        url: `${baseUrl}${href}`,
        // Opaque, and the framework never parses it.
        scope: `project:${feedback.projectId}`,
      },
    };
  }

  /**
   * A short plain-text lead-in for the email body, on the same rule as
   * `MentionNotifier.excerpt`: a mail client is not the place to discover
   * that a comment was four screens of markdown.
   */
  protected excerpt(body: string): string {
    const flat = body.replace(/\s+/g, " ").trim();
    return flat.length > 240 ? `${flat.slice(0, 239)}…` : flat;
  }
}
