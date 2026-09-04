import { type Infer, z } from "alepha";

/**
 * A message re-rendered from its template, or the reason there is none.
 *
 * ⚠️ **`available: false` is a normal outcome, not an error**, which is why
 * this is a 200 carrying a reason rather than a 403 or a 404. The outbox row
 * holding the variables is purged at `retentionDays` (7 by default) while the
 * receipt lives 90, and a `sensitive` template is never rendered for an
 * operator at all. Both are states the UI has to draw, and telling them
 * apart by introspecting HTTP status codes on a thrown client error is worse
 * than reading a field. A tenant-scope failure still throws, from
 * `requireReceipt`, because that one really is "you may not see this".
 */
export const notificationPreviewResourceSchema = z.object({
  available: z.boolean(),
  reason: z.enum(["outbox-purged", "sensitive", "template-missing"]).optional(),
  channel: z.text({ maxLength: 32 }),
  /**
   * ⚠️ **Every length here is explicit, and none of them may go back to a
   * bare `z.text()`.** That defaults to `Z_LIMITS.regular`, 255 characters,
   * and a rendered email is thousands. The cap is enforced when `$action`
   * validates the RESPONSE, so the failure is not a truncated body: the
   * whole payload is rejected and the preview renders blank behind a
   * "Too big: expected string to have..." toast.
   *
   * A unit test calling the handler directly does not see this, because it
   * never crosses the route. `preview.spec.ts` validates against this schema
   * explicitly for that reason.
   */
  subject: z.text({ maxLength: 500 }).optional(),
  /**
   * The message itself: HTML for email, the text for sms and for sinks.
   *
   * Flat, and named after the channel contract's own field rather than after
   * one channel's idea of it. `html` and `message` used to be separate keys
   * chosen by a branch on the channel literal, which meant a third channel
   * had nowhere to put its body.
   */
  body: z.text({ maxLength: 1_000_000 }).optional(),
  text: z.text({ maxLength: 1_000_000 }).optional(),
  /**
   * Attachment file ids, read straight off the payload.
   *
   * The bytes are deliberately never resolved for a preview: reading them
   * throws when the object has been purged, which would turn the preview of
   * an old notification into a 500 for no benefit.
   */
  attachments: z.array(z.text()),
  /**
   * Where the body came from. Only `live` today: it is re-rendered from the
   * template as it exists NOW, which can differ from what was delivered if
   * the template has changed since.
   */
  source: z.enum(["live"]),
});

export type NotificationPreviewResource = Infer<
  typeof notificationPreviewResourceSchema
>;
