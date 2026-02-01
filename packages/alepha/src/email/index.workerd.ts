import { $module } from "alepha";
import { $email } from "./primitives/$email.ts";
import { EmailProvider } from "./providers/EmailProvider.ts";
import { MemoryEmailProvider } from "./providers/MemoryEmailProvider.ts";
import { WorkermailerEmailProvider } from "./providers/WorkermailerEmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./errors/EmailError.ts";
export * from "./primitives/$email.ts";
export * from "./providers/EmailProvider.ts";
export * from "./providers/MemoryEmailProvider.ts";
export * from "./providers/WorkermailerEmailProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaEmail = $module({
  name: "alepha.email",
  primitives: [$email],
  services: [EmailProvider, MemoryEmailProvider, WorkermailerEmailProvider],
  register: (alepha) => {
    if (alepha.env.EMAIL_HOST) {
      alepha.with({
        optional: true,
        provide: EmailProvider,
        use: WorkermailerEmailProvider,
      });
    } else {
      alepha.with({
        optional: true,
        provide: EmailProvider,
        use: MemoryEmailProvider,
      });
    }
  },
});
