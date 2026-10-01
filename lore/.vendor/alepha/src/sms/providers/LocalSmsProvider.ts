import { $atom, $inject, $store, type Infer, z } from "alepha";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { SmsError } from "../errors/SmsError.ts";
import type { SmsProvider, SmsSendOptions } from "./SmsProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Local SMS provider configuration atom.
 *
 * An atom rather than a constructor argument, which is what it used to be:
 * nothing constructs this provider by hand (the module registers it as the
 * default `SmsProvider`), so the argument was unreachable and the directory
 * was in practice a constant. Anything wanting to read it - `DATA_DIR` below,
 * and the devtools outbox - had no way to, and hardcoded the same string a
 * second time.
 */
export const localSmsOptions = $atom({
  name: "alepha.sms.local.options",
  schema: z.object({
    directory: z
      .string()
      .describe("Directory path where SMS files will be stored"),
  }),
  default: {
    directory: "node_modules/.alepha/sms",
  },
  serverOnly: true,
});

export type LocalSmsProviderOptions = Infer<typeof localSmsOptions.schema>;

declare module "alepha" {
  interface State {
    [localSmsOptions.key]: LocalSmsProviderOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class LocalSmsProvider implements SmsProvider {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly options = $store(localSmsOptions);

  protected get directory(): string {
    return this.options.directory;
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
