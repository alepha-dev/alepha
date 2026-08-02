import { $atom, $hook, $inject, $store, type Infer, z } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import { EmailError } from "../errors/EmailError.ts";
import type { EmailProvider, EmailSendOptions } from "./EmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Local email provider configuration atom
 */
export const localEmailOptions = $atom({
  name: "alepha.email.local.options",
  schema: z.object({
    directory: z
      .string()
      .describe("Directory path where email files will be stored"),
  }),
  default: {
    directory: "node_modules/.alepha/emails",
  },
  serverOnly: true,
});

export type LocalEmailProviderOptions = Infer<typeof localEmailOptions.schema>;

declare module "alepha" {
  interface State {
    [localEmailOptions.key]: LocalEmailProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class LocalEmailProvider implements EmailProvider {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly options = $store(localEmailOptions);

  protected get directory(): string {
    return this.options.directory;
  }

  protected onStart = $hook({
    on: "start",
    handler: async () => {
      try {
        await this.fs.mkdir(this.directory, { recursive: true });
        this.log.info("Email directory OK", {
          at: this.directory,
        });
      } catch (error) {
        const message = `Failed to create email directory: ${error instanceof Error ? error.message : String(error)}`;
        this.log.error(message, { at: this.directory });
        throw new EmailError(
          message,
          error instanceof Error ? error : undefined,
        );
      }
    },
  });

  public async send(options: EmailSendOptions): Promise<void> {
    const { to, subject, body } = options;

    this.log.debug("Sending email to local file", {
      to,
      subject,
      directory: this.directory,
    });

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      for (const recipient of Array.isArray(to) ? to : [to]) {
        const sanitizedEmail = recipient.replace(/[^a-zA-Z0-9@.-]/g, "_");
        const filename = `${sanitizedEmail},${timestamp}.eml.json`;
        const filepath = this.fs.join(this.directory, filename);

        const content = this.createEmailJson({ to: recipient, subject, body });
        await this.fs.writeFile(filepath, JSON.stringify(content, null, 2));

        this.log.info("Email saved to local file", { filepath, to, subject });
      }
    } catch (error) {
      const message = `Failed to save email to local file: ${error instanceof Error ? error.message : String(error)}`;
      this.log.error(message, { to, subject, directory: this.directory });
      throw new EmailError(message, error instanceof Error ? error : undefined);
    }
  }

  public createEmailJson(options: {
    to: string;
    subject: string;
    body: string;
  }): { to: string; subject: string; body: string; sentAt: string } {
    return {
      to: options.to,
      subject: options.subject,
      body: options.body,
      sentAt: new Date().toISOString(),
    };
  }
}
