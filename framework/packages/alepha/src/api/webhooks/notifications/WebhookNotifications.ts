import { z } from "alepha";
import { $notification } from "alepha/api/notifications";

/**
 * Webhook notices, sent by the webhooks module when it disables an endpoint.
 *
 * A module variant, never registered by `AlephaApiWebhooks` itself: the
 * webhooks module stays usable without the notifications module. An app
 * turns the notice on with `alepha.with(WebhookNotifications)`. Without it,
 * an endpoint is still disabled, and the `webhooks:endpoint:disabled` hook
 * still fires.
 */
export class WebhookNotifications {
  /**
   * The notice the user who registered an endpoint gets when the module
   * disables it.
   *
   * ⚠️ Sent in the template's default language, English: it goes out from a
   * delivery job, which has no request to read a language from. The `fr`
   * translation is kept for the day a language is passed.
   *
   * `critical`, like every `security` notice: an integration that silently
   * stopped receiving events is the outage this exists to report.
   */
  public readonly endpointDisabled = $notification({
    category: "security",
    critical: true,
    description:
      "Email sent to the user who registered a webhook endpoint when the module disables it, naming its host and the reason.",
    email: {
      subject: "A webhook endpoint was disabled",
      body: (it) => `
			<h1>Webhooks to ${it.host} are disabled</h1>
			<p>${it.explanation}</p>
			<p>Events sent from now on are not delivered to it. Once the receiver is fixed, enable the endpoint again from the admin.</p>
			<p>Best regards,<br>The Team</p>
		`,
    },
    translations: {
      fr: {
        email: {
          subject: "Un point de réception de webhooks a été désactivé",
          body: (it) => `
				<h1>Les webhooks vers ${it.host} sont désactivés</h1>
				<p>${it.explanationFr}</p>
				<p>Les événements envoyés désormais ne lui sont pas livrés. Une fois le récepteur réparé, réactivez le point de réception depuis l'administration.</p>
			`,
        },
      },
    },
    schema: z.object({
      email: z.string().meta({ format: "email" }),
      host: z.string(),
      reason: z.enum(["gone", "failing", "secret"]),
      explanation: z.string(),
      explanationFr: z.string(),
    }),
  });
}
