import { NotificationHtmlEscaper } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $notification } from "alepha/api/notifications";

/**
 * Email templates for hosts. One, so far: the nightly check found a
 * Cloudflare token that no longer works.
 *
 * Its own category, `hosts`, rather than the `tasks` the quest reminder
 * uses: somebody who does not want quest nudges still wants to be told their
 * deploy credential died, and one category cannot express both.
 */
export class HostNotifications {
  protected readonly html = $inject(NotificationHtmlEscaper);

  /**
   * Sent **once, on the flip**: when a row that passed its previous check
   * fails this one. Not on the nights it stays invalid, and never from the
   * manual "Check again", where the owner is already looking at the answer.
   * One line in `HostCredentialJobs` to change into a nightly nag.
   */
  public readonly credentialInvalid = $notification({
    category: "hosts",
    description:
      "Sent to the people who manage a host when the nightly check finds that its Cloudflare token has stopped working. Deploys through the host are refused until the token is replaced.",
    email: {
      subject: "A deploy credential stopped working",
      body: (it) => {
        const slug = this.html.escape(it.hostSlug);
        const reason = this.html.escape(it.reason);
        const hostsUrl = encodeURI(it.hostsUrl);
        return `
        <h1>${slug}: the Cloudflare token stopped working</h1>
        <p>Lore re-checks every Cloudflare host once a night. Tonight, <strong>${slug}</strong> did not pass:</p>
        <p><em>${reason}</em></p>
        <p>Deploys through this host are refused until you replace the token. Mint a new one at Cloudflare with the same permissions, then open the host and use <strong>Replace token</strong>.</p>${it.homeless ? "<p>This host belongs to no project yet: until an instance admin assigns it one, only you are told, and nobody but an admin can open it.</p>" : ""}
        <p>
          <a href="${hostsUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Open my hosts
          </a>
        </p>
      `;
      },
    },
    schema: z.object({
      hostSlug: z.string(),
      reason: z.string(),
      hostsUrl: z.string(),
      /**
       * The host has no home project yet (#E126), so the message says an
       * admin assigns it.
       */
      homeless: z.boolean().optional(),
    }),
  });

  /**
   * A host set with a TTL (`lore host add --ttl`) is past it (#Q3138).
   * Sent once per expiry by `HostExpiryJobs`; extending or clearing the TTL
   * re-arms it. Lore deletes nothing and stops nothing: the server keeps
   * billing until its owner deletes it.
   */
  public readonly overdue = $notification({
    category: "hosts",
    description:
      "Sent once to the people who manage a host when a throwaway host is past the TTL it was given. Nothing is stopped or deleted.",
    email: {
      subject: (it) => `${it.hostSlug} is past its expiry`,
      body: (it) => {
        const slug = this.html.escape(it.hostSlug);
        const hostsUrl = encodeURI(it.hostsUrl);
        return `
        <h1>${slug} was meant to be gone by now</h1>
        <p>This host was given a time to live, and it expired at ${this.html.escape(it.expiresAt)}. Lore stops nothing and deletes nothing: the server is still running, and still billing, until you delete it.</p>
        <p>Delete it with <code>lore host delete ${slug}</code>, then delete the server with its provider. Or extend it with <code>lore host update ${slug} --ttl 2h</code>.</p>${it.homeless ? "<p>This host belongs to no project yet: until an instance admin assigns it one, only you are told, and nobody but an admin can open it.</p>" : ""}
        <p>
          <a href="${hostsUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Open my hosts
          </a>
        </p>
      `;
      },
    },
    schema: z.object({
      hostSlug: z.string(),
      expiresAt: z.string(),
      hostsUrl: z.string(),
      /**
       * The host has no home project yet (#E126).
       */
      homeless: z.boolean().optional(),
    }),
  });

  /**
   * The same, in the header bell.
   */
  public readonly overdueInbox = $notification({
    name: "lore:host:overdue",
    category: "hosts",
    description:
      "Filed in the header bell of the people who manage a host when a throwaway host is past its TTL. Links to the account's hosts.",
    schema: z.object({ hostSlug: z.text(), href: z.text() }),
    inbox: {
      title: (it) => `${it.hostSlug} is past its expiry`,
      body: () =>
        "The server is still running and billing until you delete it.",
      href: (it) => it.href,
    },
    translations: {
      fr: {
        inbox: {
          title: (it) => `${it.hostSlug} a dépassé son expiration`,
          body: () =>
            "Le serveur tourne et reste facturé tant que vous ne le supprimez pas.",
          href: (it) => it.href,
        },
      },
    },
  });
}
