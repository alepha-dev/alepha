import { z } from "alepha";
import { $notification } from "alepha/api/notifications";

/**
 * API key notices, sent by `ApiKeyJobs`.
 *
 * A module variant, never registered by `AlephaApiKeys` itself: the keys
 * module stays usable without the notifications module. `$realm` registers it
 * when a realm has both `apiKeys` and `notifications`; an application wiring
 * the modules by hand registers it with `alepha.with(ApiKeyNotifications)`.
 * Without it, the expiry notice job does nothing.
 */
export class ApiKeyNotifications {
  /**
   * The warning an API key's owner gets, once, when the key enters its
   * expiry warning window (`apiKeyOptions.expiryWarningDays`).
   *
   * ⚠️ Sent in the template's default language, English. The notice goes out
   * from a daily job, and `$notification` resolves a language from an explicit
   * `lang` or from the current request: a job has no request, and the `users`
   * entity has no language column to pass one from. The `fr` translation is
   * kept for the day it does.
   *
   * Not `sensitive`: it carries the key's name and the last characters of its
   * token, nothing that authenticates, and withholding it from the admin
   * endpoints would make its delivery unauditable.
   *
   * `critical`, like every other `security` notice: a user cannot mute it. A
   * muted warning about a credential that is about to stop working is the
   * outage it exists to prevent, and a single non-critical template would
   * make the whole `security` category appear in a preference page as
   * something to switch off.
   */
  public readonly expiring = $notification({
    category: "security",
    critical: true,
    description:
      "Email sent once to the owner of an API key that is about to expire, naming the key and the days it has left.",
    email: {
      subject: "An API key expires soon",
      body: (it) => `
			<h1>Your API key "${it.name}" expires soon</h1>
			<p>The key ending in <code>${it.tokenSuffix}</code> stops working in ${it.daysLeft} day(s).</p>
			<p>Anything still using it will be refused from then on. Rotate it from your account to get a new secret for the same key, and update wherever it is stored.</p>
			<p>If you no longer use it, there is nothing to do.</p>
			<p>Best regards,<br>The Team</p>
		`,
    },
    translations: {
      fr: {
        email: {
          subject: "Une clé d'API expire bientôt",
          body: (it) => `
				<h1>Votre clé d'API « ${it.name} » expire bientôt</h1>
				<p>La clé se terminant par <code>${it.tokenSuffix}</code> cessera de fonctionner dans ${it.daysLeft} jour(s).</p>
				<p>Tout ce qui l'utilise encore sera refusé à partir de ce moment. Renouvelez-la depuis votre compte pour obtenir un nouveau secret pour la même clé, et mettez-la à jour là où elle est enregistrée.</p>
				<p>Si vous ne l'utilisez plus, vous n'avez rien à faire.</p>
			`,
        },
      },
    },
    schema: z.object({
      email: z.string().meta({ format: "email" }),
      name: z.string(),
      tokenSuffix: z.string(),
      daysLeft: z.number(),
    }),
  });
}
