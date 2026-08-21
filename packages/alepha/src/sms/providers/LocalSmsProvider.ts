import { $inject } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { SmsError } from "../errors/SmsError.ts";
import type { SmsProvider, SmsSendOptions } from "./SmsProvider.ts";

export interface LocalSmsProviderOptions {
  /**
   * Directory to save SMS files.
   * @default "node_modules/.alepha/sms" (relative to project root)
   */
  directory?: string;
}

export class LocalSmsProvider implements SmsProvider {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly directory: string;

  constructor(options: LocalSmsProviderOptions = {}) {
    this.directory = options.directory ?? "node_modules/.alepha/sms";
  }

  public async send(options: SmsSendOptions): Promise<void> {
    const { to, message } = options;

    this.log.debug("Sending SMS to local file", {
      to,
      message,
      directory: this.directory,
    });

    try {
      // Ensure directory exists
      await this.fs.mkdir(this.directory, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      for (const recipient of Array.isArray(to) ? to : [to]) {
        const sanitizedPhone = recipient.replace(/[^0-9+]/g, "_");
        const filename = `${sanitizedPhone},${timestamp}.sms.json`;
        const filepath = this.fs.join(this.directory, filename);

        const content = this.createSmsJson({ to: recipient, message });
        await this.fs.writeFile(filepath, JSON.stringify(content, null, 2));

        this.log.info("SMS saved to local file", { filepath, to });
      }
    } catch (error) {
      const message = `Failed to save SMS to local file: ${error instanceof Error ? error.message : String(error)}`;
      this.log.error(message, { to, directory: this.directory });
      throw new SmsError(message, error instanceof Error ? error : undefined);
    }
  }

  public createSmsJson(options: { to: string; message: string }): {
    to: string;
    message: string;
    sentAt: string;
  } {
    return {
      to: options.to,
      message: options.message,
      sentAt: new Date().toISOString(),
    };
  }
}
