import { Alepha } from "alepha";
import type { Transporter } from "nodemailer";

import { emailProviderConformance } from "../../core/__tests__/emailProviderConformance.ts";
import { NodemailerEmailProvider } from "../providers/NodemailerEmailProvider.ts";

interface SentMail {
  from?: string;
  to?: string | string[];
  subject?: string;
  html?: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

class RecordingTransport {
  public readonly sent: SentMail[] = [];

  async sendMail(mail: SentMail) {
    this.sent.push(mail);
    return { messageId: `smtp-msg-${this.sent.length}`, response: "250 OK" };
  }

  async verify() {
    return true;
  }

  close() {}
}

class TestProvider extends NodemailerEmailProvider {
  public readonly transport = new RecordingTransport();

  protected override createTransporter(): Transporter {
    return this.transport as unknown as Transporter;
  }
}

emailProviderConformance("NodemailerEmailProvider", async () => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      EMAIL_HOST: "smtp.example.com",
      EMAIL_FROM: "noreply@example.com",
    },
  });
  const provider = alepha.inject(TestProvider);
  await alepha.start();

  return {
    provider,
    lastSent: () => {
      const mail = provider.transport.sent[provider.transport.sent.length - 1];
      if (!mail) return undefined;
      return {
        to: Array.isArray(mail.to) ? mail.to : [mail.to as string],
        subject: mail.subject as string,
        html: mail.html,
        text: mail.text,
        replyTo: mail.replyTo,
        headers: mail.headers,
      };
    },
  };
});
