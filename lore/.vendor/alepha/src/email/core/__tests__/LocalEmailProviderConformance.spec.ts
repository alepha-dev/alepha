import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";

import { LocalEmailProvider } from "../providers/LocalEmailProvider.ts";
import { emailProviderConformance } from "./emailProviderConformance.ts";

emailProviderConformance("LocalEmailProvider", async () => {
  const alepha = Alepha.create().with({
    provide: FileSystemProvider,
    use: MemoryFileSystemProvider,
  });

  const provider = alepha.inject(LocalEmailProvider);
  const fs = alepha.inject(MemoryFileSystemProvider);
  await alepha.start();

  return {
    provider,
    lastSent: () => {
      const call = fs.writeFileCalls[fs.writeFileCalls.length - 1];
      if (!call) return undefined;
      const written = JSON.parse(call.data as string);
      return {
        to: [written.to],
        subject: written.subject,
        html: written.body,
        text: written.text,
        replyTo: written.replyTo,
        headers: written.headers,
      };
    },
  };
});
