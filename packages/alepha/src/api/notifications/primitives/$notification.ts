import {
  $inject,
  createPrimitive,
  KIND,
  Primitive,
  type Static,
  type StaticEncode,
  type TObject,
} from "alepha";
import { NotificationJobs } from "../jobs/NotificationJobs.ts";

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
 *     schema: t.object({ username: t.text(), activationLink: t.text() }),
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
export const $notification = <T extends TObject>(
  options: NotificationPrimitiveOptions<T>,
) => createPrimitive(NotificationPrimitive<T>, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface NotificationPrimitiveOptions<T extends TObject>
  extends NotificationMessage<T> {
  name?: string;
  description?: string;
  category?: string;
  critical?: boolean;
  sensitive?: boolean;
  translations?: {
    // e.g., "en", "fr", even "en-US"
    [lang: string]: NotificationMessage<T>;
  };
  schema: T;
}

// ---------------------------------------------------------------------------------------------------------------------

export class NotificationPrimitive<T extends TObject> extends Primitive<
  NotificationPrimitiveOptions<T>
> {
  protected readonly notificationJobs = $inject(NotificationJobs);

  public get name() {
    return this.options.name ?? `${this.config.propertyKey}`;
  }

  public async push(options: NotificationPushOptions<T>) {
    const pushOpts = this.options.critical
      ? ({ priority: "critical" } as const)
      : undefined;

    if (this.options.email) {
      await this.notificationJobs.sendNotification.push(
        {
          type: "email",
          template: this.name,
          contact: options.contact,
          variables: options.variables as Record<string, unknown>,
          category: this.options.category,
          critical: this.options.critical,
          sensitive: this.options.sensitive,
        },
        pushOpts,
      );
    }

    if (this.options.sms) {
      await this.notificationJobs.sendNotification.push(
        {
          type: "sms",
          template: this.name,
          contact: options.contact,
          variables: options.variables as Record<string, unknown>,
          category: this.options.category,
          critical: this.options.critical,
          sensitive: this.options.sensitive,
        },
        pushOpts,
      );
    }
  }

  public configure(options: Partial<NotificationPrimitiveOptions<T>>) {
    Object.assign(this.options, options);
  }
}

$notification[KIND] = NotificationPrimitive;

// ---------------------------------------------------------------------------------------------------------------------

export interface NotificationPushOptions<T extends TObject> {
  variables: StaticEncode<T>;
  contact: string;
}

export interface NotificationMessage<T extends TObject> {
  email?: {
    subject: string;
    body: string | ((variables: Static<T>) => string);
  };
  sms?: {
    message: string | ((variables: Static<T>) => string);
  };
}
