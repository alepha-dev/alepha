import { $inject, z } from "alepha";
import { $notification } from "alepha/api/notifications";

import { formatReference } from "../../web/app/components/shared/element/typedReference.ts";
import { NotificationHtmlEscaper } from "./NotificationHtmlEscaper.ts";

/**
 * The two things Lore tells somebody about, each on both channels.
 *
 * Every template here declares `inbox` **and** `email`, and the two blocks
 * are written separately rather than one reusing the other's strings. An
 * inbox `title` is a one-line label read in a dropdown; an email is the whole
 * message. Sharing only their variables is what the option-block design is
 * for.
 *
 * ⚠️ **Both carry an explicit `name`.** `$notification` falls back to the
 * property key, and that string lands in `notification_deliveries.template`,
 * in the admin filter bar and in `NotificationPreferenceOptions.template`. A
 * rename refactor would otherwise silently rewrite a value already written
 * into ninety days of receipts.
 *
 * ⚠️ **The categories are the preference axis.** `mentions` and `releases`
 * are distinct because somebody who wants to hear their name still may not
 * want every release, and one category cannot express both.
 *
 * ⚠️ **Every push passes an explicit `lang`.** `$notification` resolves the
 * language from the CURRENT REQUEST, which belongs to whoever triggered the
 * message, and `users` carries no language column. A French author pinging
 * an English colleague would otherwise mail them French. The `translations`
 * blocks below are therefore written and **dormant**: they are correct the
 * day a language lands on the account, and they do nothing today.
 */
export class LoreInboxNotifications {
  protected readonly html = $inject(NotificationHtmlEscaper);

  /**
   * The language every push in this epic sends in.
   *
   * ⚠️ **Explicit, and one constant rather than a literal per call site.**
   * `$notification` resolves the language from the CURRENT REQUEST, which
   * belongs to whoever triggered the message: a French author pinging an
   * English colleague would mail them French, unpredictably, per message.
   * `pushMany` has no fallback at all - its per-contact `lang` is documented
   * as explicit only.
   *
   * And there is nothing better to read: `users` carries no `language`
   * column, and Lore's language lives in a cookie in the reader's browser.
   * Adding that column is a real feature with a settings surface and a
   * backfill, and this is the one place that changes the day it lands.
   */
  public readonly lang = "en";

  /**
   * Somebody wrote your name in a comment.
   *
   * `reference` is built by the caller through `formatReference`, never by
   * hand: `#Q402` is the grammar of epic #32 and it has one implementation.
   */
  public readonly inboxMention = $notification({
    name: "lore:inbox:mention",
    category: "mentions",
    description:
      "Sent to a project member whose name appears in a quest or feedback comment written by another member.",
    schema: z.object({
      /**
       * The reference the comment is on, already formatted: `#Q402`, `#P120`.
       */
      reference: z.text(),
      subjectTitle: z.text(),
      authorName: z.text(),
      /**
       * A short plain-text excerpt of the comment, for the email body.
       */
      excerpt: z.text(),
      projectTitle: z.text(),
      /**
       * Where the message points, relative to the app root.
       */
      href: z.text(),
      /**
       * The same destination, absolute, for the email's button.
       */
      url: z.text(),
      /**
       * The opaque partition, `project:<id>`. Never parsed by anything.
       */
      scope: z.text(),
    }),
    inbox: {
      title: (it) => `${it.authorName} mentioned you in ${it.reference}`,
      body: (it) => it.subjectTitle,
      href: (it) => it.href,
      scope: (it) => it.scope,
      scopeLabel: (it) => it.projectTitle,
    },
    email: {
      subject: (it) => `${it.authorName} mentioned you in ${it.reference}`,
      body: (it) => {
        const projectTitle = this.html.escape(it.projectTitle);
        const authorName = this.html.escape(it.authorName);
        const subjectTitle = this.html.escape(it.subjectTitle);
        const reference = this.html.escape(it.reference);
        const excerpt = this.html.escape(it.excerpt);
        const url = encodeURI(it.url);
        return `
        <h1>${projectTitle} — you were mentioned</h1>
        <p><strong>${authorName}</strong> wrote your name in a comment on ${reference}, <strong>${subjectTitle}</strong>.</p>
        <blockquote style="margin: 16px 0; padding: 8px 16px; border-left: 3px solid #e5e7eb; color: #4b5563;">${excerpt}</blockquote>
        <p>
          <a href="${url}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Open the discussion
          </a>
        </p>
      `;
      },
    },
    translations: {
      fr: {
        inbox: {
          title: (it) =>
            `${it.authorName} vous a mentionné dans ${it.reference}`,
          body: (it) => it.subjectTitle,
          href: (it) => it.href,
          scope: (it) => it.scope,
          scopeLabel: (it) => it.projectTitle,
        },
        email: {
          subject: (it) =>
            `${it.authorName} vous a mentionné dans ${it.reference}`,
          body: (it) => {
            const projectTitle = this.html.escape(it.projectTitle);
            const authorName = this.html.escape(it.authorName);
            const subjectTitle = this.html.escape(it.subjectTitle);
            const reference = this.html.escape(it.reference);
            const excerpt = this.html.escape(it.excerpt);
            const url = encodeURI(it.url);
            return `
        <h1>${projectTitle} — vous avez été mentionné</h1>
        <p><strong>${authorName}</strong> a écrit votre nom dans un commentaire sur ${reference}, <strong>${subjectTitle}</strong>.</p>
        <blockquote style="margin: 16px 0; padding: 8px 16px; border-left: 3px solid #e5e7eb; color: #4b5563;">${excerpt}</blockquote>
        <p>
          <a href="${url}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Ouvrir la discussion
          </a>
        </p>
      `;
          },
        },
      },
    },
  });

  /**
   * A release shipped in a project you belong to.
   */
  public readonly inboxReleasePublished = $notification({
    name: "lore:inbox:release-published",
    category: "releases",
    description:
      "Sent to every member of a project when one of its releases is published.",
    schema: z.object({
      releaseTag: z.text(),
      releaseTitle: z.text(),
      projectTitle: z.text(),
      /**
       * How many quests the release shipped, for the email's one line of
       * substance.
       */
      questCount: z.integer(),
      href: z.text(),
      url: z.text(),
      scope: z.text(),
    }),
    inbox: {
      title: (it) => `${it.projectTitle} released ${it.releaseTag}`,
      body: (it) => it.releaseTitle,
      href: (it) => it.href,
      scope: (it) => it.scope,
      scopeLabel: (it) => it.projectTitle,
    },
    email: {
      subject: (it) => `${it.projectTitle} released ${it.releaseTag}`,
      body: (it) => {
        const projectTitle = this.html.escape(it.projectTitle);
        const releaseTag = this.html.escape(it.releaseTag);
        const releaseTitle = this.html.escape(it.releaseTitle);
        const url = encodeURI(it.url);
        const shipped =
          it.questCount === 1
            ? "It ships 1 quest."
            : `It ships ${it.questCount} quests.`;
        return `
        <h1>${projectTitle} — ${releaseTag} is out</h1>
        <p><strong>${releaseTitle}</strong> has been published. ${shipped}</p>
        <p>
          <a href="${url}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            See what shipped
          </a>
        </p>
      `;
      },
    },
    translations: {
      fr: {
        inbox: {
          title: (it) => `${it.projectTitle} a publié ${it.releaseTag}`,
          body: (it) => it.releaseTitle,
          href: (it) => it.href,
          scope: (it) => it.scope,
          scopeLabel: (it) => it.projectTitle,
        },
        email: {
          subject: (it) => `${it.projectTitle} a publié ${it.releaseTag}`,
          body: (it) => {
            const projectTitle = this.html.escape(it.projectTitle);
            const releaseTag = this.html.escape(it.releaseTag);
            const releaseTitle = this.html.escape(it.releaseTitle);
            const url = encodeURI(it.url);
            const shipped =
              it.questCount === 1
                ? "Elle embarque 1 quête."
                : `Elle embarque ${it.questCount} quêtes.`;
            return `
        <h1>${projectTitle} — ${releaseTag} est disponible</h1>
        <p><strong>${releaseTitle}</strong> vient d'être publiée. ${shipped}</p>
        <p>
          <a href="${url}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Voir le contenu
          </a>
        </p>
      `;
          },
        },
      },
    },
  });

  /**
   * The reference string for a quest, so a call site never builds `#Q402`
   * by hand. `formatReference` is the one implementation of that grammar.
   */
  public questReference(shortId: number): string {
    return formatReference("quest", shortId);
  }

  /**
   * The reference string for a feedback item. `#P`, not `#F`, which is a
   * folio.
   */
  public feedbackReference(shortId: number): string {
    return formatReference("feedback", shortId);
  }
}
