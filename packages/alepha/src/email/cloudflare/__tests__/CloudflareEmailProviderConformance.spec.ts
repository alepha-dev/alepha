import { Alepha } from "alepha";

import { emailProviderConformance } from "../../core/__tests__/emailProviderConformance.ts";
import {
  type CloudflareEmailBinding,
  CloudflareEmailProvider,
  type CloudflareEmailSendMessage,
  type CloudflareEmailSendResult,
  SEND_EMAIL_DEFAULT_BINDING,
} from "../providers/CloudflareEmailProvider.ts";

class RecordingBinding implements CloudflareEmailBinding {
  public calls: CloudflareEmailSendMessage[] = [];

  public async send(
    message: CloudflareEmailSendMessage,
  ): Promise<CloudflareEmailSendResult> {
    this.calls.push(message);
    return { id: "cf-msg-1", status: "queued" };
  }
}

emailProviderConformance("CloudflareEmailProvider (binding)", async () => {
  const binding = new RecordingBinding();
  const alepha = Alepha.create({
    env: { EMAIL_FROM: "noreply@example.com" },
  });
  alepha.set("cloudflare.env", { [SEND_EMAIL_DEFAULT_BINDING]: binding });

  const provider = alepha.inject(CloudflareEmailProvider);
  await alepha.start();

  return {
    provider,
    lastSent: () => {
      const call = binding.calls[binding.calls.length - 1];
      if (!call) return undefined;
      return {
        to: Array.isArray(call.to) ? call.to : [call.to],
        subject: call.subject,
        html: call.html,
        text: call.text,
        replyTo: Array.isArray(call.reply_to)
          ? call.reply_to[0]
          : call.reply_to,
        headers: call.headers,
      };
    },
  };
});
