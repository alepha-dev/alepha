import { Alepha } from "alepha";

import { MemoryEmailProvider } from "../providers/MemoryEmailProvider.ts";
import { emailProviderConformance } from "./emailProviderConformance.ts";

emailProviderConformance("MemoryEmailProvider", async () => {
  const alepha = Alepha.create();
  const provider = alepha.inject(MemoryEmailProvider);
  await alepha.start();

  return {
    provider,
    lastSent: () => {
      const record = provider.last;
      if (!record) return undefined;
      return {
        to: [record.to],
        subject: record.subject,
        html: record.body,
        text: record.text,
        replyTo: record.replyTo,
        headers: record.headers,
      };
    },
  };
});
