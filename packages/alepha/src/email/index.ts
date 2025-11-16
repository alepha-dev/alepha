import { $module } from "alepha";
import { $email } from "./descriptors/$email.ts";
import { EmailProvider } from "./providers/EmailProvider.ts";
import { LocalEmailProvider } from "./providers/LocalEmailProvider.ts";
import { MemoryEmailProvider } from "./providers/MemoryEmailProvider.ts";
import { NodemailerEmailProvider } from "./providers/NodemailerEmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./descriptors/$email.ts";
export * from "./errors/EmailError.ts";
export * from "./providers/EmailProvider.ts";
export * from "./providers/LocalEmailProvider.ts";
export * from "./providers/MemoryEmailProvider.ts";
export * from "./providers/NodemailerEmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "alepha" {
  interface Hooks {
    "email:sending": {
      to: string | string[];
      template: string;
      variables: Record<string, unknown>;
      provider: EmailProvider;
      abort(): void;
    };
    "email:sent": {
      to: string | string[];
      template: string;
      provider: EmailProvider;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides email sending capabilities for Alepha applications with multiple provider backends.
 *
 * The email module enables declarative email sending through the `$email` descriptor, allowing you to send
 * emails through different providers: memory (for testing), local file system, or SMTP via Nodemailer.
 * It supports HTML email content and automatic provider selection based on environment configuration.
 *
 * @see {@link EmailProvider}
 * @module alepha.email
 */
export const AlephaEmail = $module({
  name: "alepha.email",
  descriptors: [$email],
  services: [
    EmailProvider,
    MemoryEmailProvider,
    LocalEmailProvider,
    NodemailerEmailProvider,
  ],
  register: (alepha) =>
    alepha.with({
      optional: true,
      provide: EmailProvider,
      use: MemoryEmailProvider,
    }),
});
