import { z } from "alepha";
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
  /**
   * Escape the estate's own strings before they land inside the HTML body.
   * The slug is the owner's, but the failure sentence carries an account id
   * that came off a form, and a DKIM-signed email is a high-trust surface to
   * inject an anchor into.
   */
  protected escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

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
        const slug = this.escapeHtml(it.estateSlug);
        const reason = this.escapeHtml(it.reason);
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
}
