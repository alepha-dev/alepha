import { $module } from "alepha";
import { $email } from "./primitives/$email.ts";
import { EmailProvider } from "./providers/EmailProvider.ts";
import { LocalEmailProvider } from "./providers/LocalEmailProvider.ts";
import { MemoryEmailProvider } from "./providers/MemoryEmailProvider.ts";
import { NodemailerEmailProvider } from "./providers/NodemailerEmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/EmailError.ts";
export * from "./primitives/$email.ts";
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
 * | Stability | Since | Runtime |
 * |-----------|-------|---------|
 * | 3 - stable | 0.4.0 | node, bun, workerd|
 *
 * Email delivery with template support.
 *
 * **Features:**
 * - Send emails with templates
 * - Multiple recipients
 * - SMTP via Nodemailer
 * - Local file provider for development
 *
 * @module alepha.email
 */
export const AlephaEmail = $module({
  name: "alepha.email",
  primitives: [$email],
  services: [
    EmailProvider,
    MemoryEmailProvider,
    LocalEmailProvider,
    NodemailerEmailProvider,
  ],
  register: (alepha) => {
    if (alepha.isTest()) {
      alepha.with({
        optional: true,
        provide: EmailProvider,
        use: MemoryEmailProvider,
      });
    } else if (alepha.env.EMAIL_HOST) {
      alepha.with({
        optional: true,
        provide: EmailProvider,
        use: NodemailerEmailProvider,
      });
    } else {
      if (alepha.isServerless()) {
        alepha.with({
          optional: true,
          provide: EmailProvider,
          use: MemoryEmailProvider,
        });
      } else {
        alepha.with({
          optional: true,
          provide: EmailProvider,
          use: LocalEmailProvider,
        });
      }
    }
  },
});
