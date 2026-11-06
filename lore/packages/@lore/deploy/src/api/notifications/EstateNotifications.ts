import { NotificationHtmlEscaper } from "@lore/core/api";
import { $inject, z } from "alepha";
import { $notification } from "alepha/api/notifications";

/**
 * Email templates for estates. One, so far: the nightly check found a
 * Cloudflare token that no longer works.
 *
 * Its own category, `estates`, rather than the `tasks` the quest reminder
 * uses: somebody who does not want quest nudges still wants to be told their
 * deploy credential died, and one category cannot express both.
 */
export class EstateNotifications {
  protected readonly html = $inject(NotificationHtmlEscaper);

  /**
   * Sent **once, on the flip**: when a row that passed its previous check
   * fails this one. Not on the nights it stays invalid, and never from the
   * manual "Check again", where the owner is already looking at the answer.
   * One line in `EstateCredentialJobs` to change into a nightly nag.
   */
  public readonly credentialInvalid = $notification({
    category: "estates",
    description:
      "Sent to an estate's owner when the nightly check finds that its Cloudflare token has stopped working. Deploys through the estate are refused until the token is replaced.",
    email: {
      subject: "A deploy credential stopped working",
      body: (it) => {
        const slug = this.html.escape(it.estateSlug);
        const reason = this.html.escape(it.reason);
        const estatesUrl = encodeURI(it.estatesUrl);
        return `
        <h1>${slug} — the Cloudflare token stopped working</h1>
        <p>Lore re-checks every Cloudflare estate once a night. Tonight, <strong>${slug}</strong> did not pass:</p>
        <p><em>${reason}</em></p>
        <p>Deploys through this estate are refused until you replace the token. Mint a new one at Cloudflare with the same permissions, then open the estate and use <strong>Replace token</strong>.</p>
        <p>
          <a href="${estatesUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Open my estates
          </a>
        </p>
      `;
      },
    },
    schema: z.object({
      estateSlug: z.string(),
      reason: z.string(),
      estatesUrl: z.string(),
    }),
  });

  /**
   * An estate set with a TTL (`lore estate add --ttl`) is past it (#Q3138).
   * Sent once per expiry by `EstateExpiryJobs`; extending or clearing the TTL
   * re-arms it. Lore deletes nothing and stops nothing: the server keeps
   * billing until its owner deletes it.
   */
  public readonly overdue = $notification({
    category: "estates",
    description:
      "Sent once to an estate's owner when a throwaway estate is past the TTL it was given. Nothing is stopped or deleted.",
    email: {
      subject: (it) => `${it.estateSlug} is past its expiry`,
      body: (it) => {
        const slug = this.html.escape(it.estateSlug);
        const estatesUrl = encodeURI(it.estatesUrl);
        return `
        <h1>${slug} was meant to be gone by now</h1>
        <p>This estate was given a time to live, and it expired at ${this.html.escape(it.expiresAt)}. Lore stops nothing and deletes nothing: the server is still running, and still billing, until you delete it.</p>
        <p>Delete it with <code>lore estate delete ${slug}</code>, then delete the server with its provider. Or extend it with <code>lore estate update ${slug} --ttl 2h</code>.</p>
        <p>
          <a href="${estatesUrl}" style="display: inline-block; padding: 10px 20px; background-color: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">
            Open my estates
          </a>
        </p>
      `;
      },
    },
    schema: z.object({
      estateSlug: z.string(),
      expiresAt: z.string(),
      estatesUrl: z.string(),
    }),
  });

  /**
   * The same, in the header bell.
   */
  public readonly overdueInbox = $notification({
    name: "lore:estate:overdue",
    category: "estates",
    description:
      "Filed in the owner's header bell when a throwaway estate is past its TTL. Links to the account's estates.",
    schema: z.object({ estateSlug: z.text(), href: z.text() }),
    inbox: {
      title: (it) => `${it.estateSlug} is past its expiry`,
      body: () =>
        "The server is still running and billing until you delete it.",
      href: (it) => it.href,
    },
    translations: {
      fr: {
        inbox: {
          title: (it) => `${it.estateSlug} a dépassé son expiration`,
          body: () =>
            "Le serveur tourne et reste facturé tant que vous ne le supprimez pas.",
          href: (it) => it.href,
        },
      },
    },
  });
}
