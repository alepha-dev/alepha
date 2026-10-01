import { Alepha, z } from "alepha";
import { AlephaApiJobs, JobProvider } from "alepha/api/jobs";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSms } from "alepha/sms";
import { describe, it } from "vitest";

import {
  $notification,
  AlephaApiNotifications,
  NotificationJobs,
} from "../index.ts";

/**
 * The notifications module historically forced `AlephaApiJobsQueue`. After
 * the direct-mode change it must boot without any queue infrastructure and
 * deliver via direct mode (push → process in-process → row removed on success).
 */
describe("AlephaApiNotifications — runs without AlephaApiJobsQueue", () => {
  it("module starts in direct mode and delivers an email notification", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaEmail)
      .with(AlephaSms)
      .with(AlephaApiJobs)
      .with(AlephaApiNotifications);

    class Templates {
      readonly welcome = $notification({
        name: "welcome-email",
        schema: z.object({ name: z.text() }),
        email: {
          subject: "Welcome",
          body: (vars) => `Hello ${vars.name}`,
        },
      });
    }

    const templates = alepha.inject(Templates);
    await alepha.start();

    // Confirm the underlying $job runs in direct mode (no queue loaded).
    const jobs = alepha.inject(JobProvider);
    const sendName = alepha.inject(NotificationJobs).sendNotification.name;
    expect(jobs.effectiveMode(sendName)).toBe("direct");

    await templates.welcome.push({
      contact: "alice@example.com",
      variables: { name: "Alice" },
    });

    const mail = alepha.inject(MemoryEmailProvider);
    const deadline = Date.now() + 1500;
    while (mail.records.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(mail.records).toHaveLength(1);
    expect(mail.records[0].to).toBe("alice@example.com");
    expect(mail.records[0].subject).toBe("Welcome");
    expect(mail.records[0].body).toBe("Hello Alice");
  });
});
