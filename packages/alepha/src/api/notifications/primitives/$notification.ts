import {
  $inject,
  createPrimitive,
  type Infer,
  KIND,
  Primitive,
  type ZObject,
} from "alepha";
import type { PushManyItem } from "alepha/api/jobs";
import type { DurationLike } from "alepha/datetime";
import { currentTenantAtom } from "alepha/security";

import { NotificationJobs } from "../jobs/NotificationJobs.ts";
import type { NotificationAttachment } from "../schemas/notificationAttachmentSchema.ts";

/**
 * Creates a notification primitive for managing email/SMS notification templates.
 *
 * Provides type-safe, reusable notification templates with multi-language support,
 * variable substitution, and categorization for different notification channels.
 *
 * @example
 * ```ts
 * class NotificationTemplates {
 *   welcomeEmail = $notification({
 *     name: "welcome-email",
 *     category: "onboarding",
 *     schema: z.object({ username: z.text(), activationLink: z.text() }),
 *     email: {
 *       subject: "Welcome to our platform!",
 *       body: (vars) => `Hello ${vars.username}, click: ${vars.activationLink}`
 *     }
 *   });
 *
 *   async sendWelcome(user: User) {
 *     await this.welcomeEmail.push({
 *       variables: { username: user.name, activationLink: generateLink() },
 *       contact: user.email
 *     });
 *   }
 * }
 * ```
 */
export const $notification = <T extends ZObject>(
  options: NotificationPrimitiveOptions<T>,
) => createPrimitive(NotificationPrimitive<T>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface NotificationPrimitiveOptions<
  T extends ZObject,
> extends NotificationMessage<T> {
  name?: string;
  description?: string;
  category?: string;
  critical?: boolean;
  /**
   * Marks the template's rendered `variables` as personal data. Admin
   * endpoints withhold them (the notification itself is still delivered and
   * listed) — use it for password resets, verification codes, invoices, and
   * anything else an operator should not be able to read after the fact.
   */
  sensitive?: boolean;
  translations?: {
    // e.g., "en", "fr", even "en-US"
    [lang: string]: NotificationMessage<T>;
  };
  schema: T;
}

// ---------------------------------------------------------------------------------------------------------------------

export class NotificationPrimitive<T extends ZObject> extends Primitive<
  NotificationPrimitiveOptions<T>
> {
  protected readonly notificationJobs = $inject(NotificationJobs);

  public get name() {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  /**
   * Recipient language for `translations` resolution. Explicit `lang` wins;
   * otherwise the language is captured FROM THE CURRENT REQUEST at push time
   * (the i18n `lang` cookie, then `Accept-Language`) — the send job may run
   * out of request context, so this must be resolved here, not in the sender.
   */
  protected resolveLang(explicit?: string): string | undefined {
    if (explicit) return explicit;
    const request = this.alepha.store.get("alepha.http.request") as
      | { headers?: Record<string, string | undefined> }
      | undefined;
    const cookie = request?.headers?.cookie;
    const fromCookie = cookie?.match(/(?:^|;\s*)lang=([a-zA-Z-]+)/)?.[1];
    if (fromCookie) return fromCookie;
    const accept = request?.headers?.["accept-language"];
    return accept?.split(",")[0]?.trim().split(";")[0] || undefined;
  }

  /**
   * The channels this template declares.
   *
   * One job row per channel, never one row that fans out: a delivery receipt
   * is per message, so a row that sent two messages could not carry both
   * their ids.
   */
  protected channels(): Array<"email" | "sms"> {
    const channels: Array<"email" | "sms"> = [];
    if (this.options.email) channels.push("email");
    if (this.options.sms) channels.push("sms");
    return channels;
  }

  protected payloadFor(
    type: "email" | "sms",
    entry: {
      contact: string;
      variables: Infer<T>;
      lang?: string;
      attachments?: NotificationAttachment[];
    },
    organizationId?: string,
  ) {
    return {
      type,
      template: this.name,
      contact: entry.contact,
      variables: entry.variables as Record<string, unknown>,
      category: this.options.category,
      critical: this.options.critical,
      sensitive: this.options.sensitive,
      lang: entry.lang,
      organizationId,
      attachments: entry.attachments,
    };
  }

  /**
   * Suffix a caller's key with the channel.
   *
   * A `key` reserves one `(jobName, key)` pair, and both channels of a
   * template share one job. Without this, pushing an email + sms template
   * under a single key would make the second channel dedupe against the
   * first, and exactly one of the two messages would silently never be sent.
   */
  protected channelKey(
    key: string | undefined,
    type: "email" | "sms",
  ): string | undefined {
    return key ? `${key}:${type}` : undefined;
  }

  public async push(options: NotificationPushOptions<T>) {
    const lang = this.resolveLang(options.lang);
    // Tag the outbox row with the owning tenant so the notification admin list
    // stays org-scoped (the outbox is shared by every tenant in a pooled
    // worker). Explicit `organizationId` wins (cron sweeps run out of request
    // context and pass the subject's org); otherwise fall back to the tenant
    // resolved for the current request.
    const organizationId =
      options.organizationId ?? this.alepha.store.get(currentTenantAtom)?.id;
    for (const type of this.channels()) {
      await this.notificationJobs.sendNotification.push(
        // `organizationId` goes in the payload as well as on the row: the
        // sender runs inside a job and never sees its own row, so this is
        // the only way the suppression gate learns whose message this is.
        this.payloadFor(type, { ...options, lang }, organizationId),
        {
          ...(this.options.critical ? ({ priority: "critical" } as const) : {}),
          organizationId,
          scheduledAt: options.scheduledAt,
          delay: options.delay,
          key: this.channelKey(options.key, type),
          inline: options.inline,
        },
      );
    }
  }

  /**
   * Push the same template to many contacts, one job row per contact per
   * channel.
   *
   * A convenience over `$job.pushMany`, not a campaign API: no audience, no
   * batching semantics, no per-recipient status beyond what the outbox
   * already records.
   *
   * ⚠️ It does **not** pre-filter suppressed contacts. The gate is at send
   * time and stays there, because a suppression can land between the push
   * and the send. Dropping suppressed contacts here as well would be an
   * optimisation (one `inArray` query against a large roster instead of a
   * job row per suppressed contact), and a second place for the rule to live
   * and drift. Measure before adding it.
   *
   * @returns how many rows were pushed.
   */
  public async pushMany(
    options: NotificationPushManyOptions<T>,
  ): Promise<number> {
    if (options.contacts.length === 0) {
      return 0;
    }

    const organizationId =
      options.organizationId ?? this.alepha.store.get(currentTenantAtom)?.id;
    const channels = this.channels();

    const items: PushManyItem[] = [];
    for (const entry of options.contacts) {
      for (const type of channels) {
        items.push({
          payload: this.payloadFor(type, entry, organizationId),
          organizationId,
          scheduledAt: options.scheduledAt,
          delay: options.delay,
          key: this.channelKey(options.key?.(entry.contact), type),
          ...(this.options.critical ? ({ priority: "critical" } as const) : {}),
        });
      }
    }

    await this.notificationJobs.sendNotification.pushMany(items);
    return items.length;
  }

  public configure(options: Partial<NotificationPrimitiveOptions<T>>) {
    Object.assign(this.options, options);
  }
}

$notification[KIND] = NotificationPrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export interface NotificationPushOptions<T extends ZObject> {
  variables: Infer<T>;
  contact: string;
  /**
   * Recipient language (e.g. "fr"); defaults to the current request's.
   */
  lang?: string;
  /**
   * Send at this moment rather than now.
   *
   * ⚠️ Granularity is the job sweep, not the minute. A future `scheduledAt`
   * writes a `scheduled` row that the sweep promotes on its next tick
   * (`sweepCron`, every 15 minutes by default), so "remind at 09:00" means
   * "at the first sweep tick at or after 09:00".
   */
  scheduledAt?: Date;
  /**
   * Send after this much time, e.g. `[1, "hour"]`. An alternative spelling
   * of {@link scheduledAt} and subject to the same sweep granularity.
   */
  delay?: DurationLike;
  /**
   * Reserve this key so a concurrent duplicate does not create a second row.
   *
   * ⚠️ **This is concurrency dedup, not idempotence over time.** The job
   * layer clears the key on BOTH terminal states, success and terminal
   * failure alike. So a repeated key returns the first execution only while
   * it is still pending, running or scheduled; once the send has completed,
   * the same key pushes a second row and sends a second message.
   *
   * Dating a key (`quest-1-2026-08-27`) is still good hygiene against a
   * double-fire inside one sweep tick. It does NOT give you "at most one
   * reminder per quest per day": for that, keep your own marker on the
   * subject row, or look up the delivery receipt.
   *
   * The channel is appended internally, so a template with both an email and
   * an sms does not dedupe one against the other.
   */
  key?: string;
  /**
   * Send inline and wait for it: the promise resolves once the provider has
   * accepted the message, and rejects if it refused. Nothing retries a send
   * that failed this way.
   *
   * For a time-limited payload this is the difference between the user
   * learning immediately and the user learning nothing. `codeExpiration`
   * defaults to 300 s while the job sweep runs every 900 s, so a retried
   * verification code is guaranteed to arrive after it expired.
   *
   * ⚠️ **A template with both channels blocks on both, in sequence.** And a
   * send addressed to somebody other than the caller must not use this: the
   * response time then tells an unauthenticated visitor whether the account
   * existed. See {@link JobPrimitiveOptions.inline}.
   */
  inline?: boolean;
  /**
   * Files to attach, as `{ storage, fileId }` references into a `$storage`.
   * They are read at send time, never carried in the queued payload.
   */
  attachments?: NotificationAttachment[];
  /**
   * Owning tenant for this notification. Defaults to the tenant resolved for
   * the current request. Pass it explicitly when sending from a context with no
   * request tenant — e.g. a cron sweep that fans out across clubs (use the
   * subject entity's `organizationId`) — so the row stays correctly org-scoped.
   */
  organizationId?: string;
}

export interface NotificationPushManyOptions<T extends ZObject> {
  /**
   * One entry per recipient. Each carries its own variables and, when it
   * matters, its own language.
   */
  contacts: Array<{
    contact: string;
    variables: Infer<T>;
    /**
     * Recipient language. **Explicit only.** `push()` can fall back to the
     * current request's cookie or `Accept-Language`; a fan-out is typically
     * a cron with no request at all, and guessing one language for a whole
     * roster is worse than falling back to the template's default.
     */
    lang?: string;
  }>;
  /**
   * Owning tenant for every row in this batch. From a cron there is no
   * request to resolve one, so pass it.
   */
  organizationId?: string;
  scheduledAt?: Date;
  delay?: DurationLike;
  /**
   * Build a dedup key per contact. Read {@link NotificationPushOptions.key}
   * first: it buys less than it looks like it does.
   */
  key?: (contact: string) => string;
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * What the sender adds to a template's own variables at render time.
 */
export interface NotificationBodyExtras {
  /**
   * The absolute unsubscribe URL for this message, so an app can put a
   * visible link in its footer. The framework sets the `List-Unsubscribe`
   * header itself and never injects markup into a body it does not own.
   *
   * Undefined on a `critical` template (there is nothing to opt out of) and
   * when `PUBLIC_URL` is unset.
   */
  unsubscribeUrl?: string;
}

export interface NotificationMessage<T extends ZObject> {
  email?: {
    /**
     * The subject line, or a function building it from the template's
     * variables.
     *
     * A function for the same reason {@link NotificationMessage.email.body}
     * is one: the subject is what a phone shows in its notification, so a
     * sign-in code or an amount belongs there rather than behind a tap. It
     * sees the same values the body does, `unsubscribeUrl` included, and may
     * be asynchronous. A plain string keeps working unchanged.
     *
     * ⚠️ A subject can therefore carry personal data, which is what
     * `sensitive` on the same template is for: the delivery receipt stores
     * `null` instead of the subject when it is set.
     */
    subject:
      | string
      | ((
          variables: Infer<T> & NotificationBodyExtras,
        ) => string | Promise<string>);
    /**
     * The rendered HTML body, or a function building it from the template's
     * variables.
     *
     * The function may be asynchronous. `render()` from `alepha/react/email`
     * returns one, and so does anything that has to await something (a fetch,
     * a storage read) before it can produce the body. A synchronous function
     * and a plain string both keep working unchanged.
     */
    body:
      | string
      | ((
          variables: Infer<T> & NotificationBodyExtras,
        ) => string | Promise<string>);
    /**
     * The plain-text alternative to {@link body}.
     *
     * Optional, and rarely worth writing: when it is absent the sender
     * derives one from the rendered HTML, so every template gets a text part
     * without being rewritten. Declare it only when the derivation reads
     * badly for this particular message; what you write here always wins.
     */
    text?:
      | string
      | ((
          variables: Infer<T> & NotificationBodyExtras,
        ) => string | Promise<string>);
  };
  sms?: {
    /**
     * The message text, or a function building it from the template's
     * variables. May be asynchronous, exactly like the email body.
     */
    message:
      | string
      | ((
          variables: Infer<T> & NotificationBodyExtras,
        ) => string | Promise<string>);
  };
}
