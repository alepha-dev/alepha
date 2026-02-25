import { $atom, $hook, $inject, $use, type Static, t } from "alepha";
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
  schema: t.object({
    directory: t.string({
      description: "Directory path where email files will be stored",
    }),
  }),
  default: {
    directory: "node_modules/.alepha/emails",
  },
});

export type LocalEmailProviderOptions = Static<typeof localEmailOptions.schema>;

declare module "alepha" {
  interface State {
    [localEmailOptions.key]: LocalEmailProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class LocalEmailProvider implements EmailProvider {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly options = $use(localEmailOptions);

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
      // Create filename: emailcontact+date
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      for (const recipient of Array.isArray(to) ? to : [to]) {
        const sanitizedEmail = recipient.replace(/[^a-zA-Z0-9@.-]/g, "_");
        const filename = `${sanitizedEmail}+${timestamp}.html`;
        const filepath = this.fs.join(this.directory, filename);

        // Create HTML content
        const htmlContent = this.createEmailHtml({
          to: recipient,
          subject,
          body,
        });

        // Write to file
        await this.fs.writeFile(filepath, htmlContent);

        this.log.info("Email saved to local file", { filepath, to, subject });
      }
    } catch (error) {
      const message = `Failed to save email to local file: ${error instanceof Error ? error.message : String(error)}`;
      this.log.error(message, { to, subject, directory: this.directory });
      throw new EmailError(message, error instanceof Error ? error : undefined);
    }
  }

  public createEmailHtml(options: {
    to: string;
    subject: string;
    body: string;
  }): string {
    const { to, subject, body } = options;
    const timestamp = new Date().toISOString();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(subject)}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .email-header { background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .email-body { background-color: #ffffff; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
        .meta { font-size: 12px; color: #666; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="email-header">
        <div class="meta">Sent: ${timestamp}</div>
        <div class="meta">To: ${this.escapeHtml(to)}</div>
        <h1>${this.escapeHtml(subject)}</h1>
    </div>
    <div class="email-body">
        ${body}
    </div>
</body>
</html>`;
  }

  public escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
