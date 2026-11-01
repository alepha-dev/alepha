import {
  InvitationController,
  LoreInboxRecipientProvider,
  LoreNotificationPreferences,
  ProjectController,
} from "@lore/core/api";
import { Alepha, z } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  notificationInboxEntity,
  NotificationInboxRecipientProvider,
  NotificationJobs,
  NotificationPreferenceProvider,
} from "alepha/api/notifications";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import { notificationPreferences } from "../src/api/entities/notificationPreferences.ts";
import { LoreCoreApi } from "../src/api/index.ts";
import { InvitationNotifications } from "../src/api/notifications/InvitationNotifications.ts";

class Probe {
  readonly inbox = $repository(notificationInboxEntity);
  readonly executions = $repository(jobExecutionEntity);
  readonly preferences = $repository(notificationPreferences);
}

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };
const userDataSchema = z.object({ username: z.string(), email: z.email() });

/**
 * An invitation reaches the invitee twice when they have an account, and once
 * when they do not (#Q2947). The email stays the one template it always was;
 * the bell is a sibling, so one is muted without the other.
 */
describe("a project invitation's notifications", () => {
  let alepha: Alepha;
  let probe: Probe;
  let mail: MemoryEmailProvider;
  let notifications: InvitationNotifications;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        SERVER_PORT: 0,
        DATABASE_URL: ":memory:",
        PUBLIC_URL: "https://lore.test",
      },
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    // The substitutions `main.server.ts` makes.
    alepha.with({
      provide: NotificationInboxRecipientProvider,
      use: LoreInboxRecipientProvider,
    });
    alepha.with({
      provide: NotificationPreferenceProvider,
      use: LoreNotificationPreferences,
    });
    alepha.with(LoreCoreApi);
    probe = alepha.inject(Probe);
    mail = alepha.inject(MemoryEmailProvider);
    notifications = alepha.inject(InvitationNotifications);
    await alepha.start();
  });

  afterEach(async () => {
    await alepha.stop();
  });

  /**
   * The job layer drains the outbox itself, so all a test does is stop
   * asserting before that has run.
   */
  const settle = async (): Promise<void> => {
    const name = alepha.inject(NotificationJobs).sendNotification.name;
    const terminal = new Set(["ok", "error", "cancelled"]);
    for (let attempt = 0; attempt < 50; attempt++) {
      const rows = await probe.executions.findMany({
        where: { jobName: { eq: name } },
      });
      if (rows.every((row) => terminal.has(String(row.status)))) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  const createUser = async (username: string) => {
    const fake = alepha.inject(FakeProvider).generate(userDataSchema);
    const res = await alepha
      .inject(AdminUserController)
      .createUser.fetch(
        { body: { ...fake, username, roles: ["user"] } },
        { user: adminUser },
      );
    return { id: res.data.id, roles: res.data.roles, email: fake.email };
  };

  const invite = async (email: string) => {
    const owner = await createUser("owner");
    const { data: project } = await alepha
      .inject(ProjectController)
      .createProject.fetch(
        { body: { title: "Invited" } },
        { user: { id: owner.id, roles: owner.roles } },
      );
    const invitation = await alepha
      .inject(InvitationController)
      .createInvitation.fetch(
        {
          body: {
            email,
            resourceType: "project",
            resourceId: String(project.id),
          },
        },
        { user: { id: owner.id, roles: owner.roles } },
      );
    await settle();
    return { project, invitation: invitation.data };
  };

  const mailsTo = (email: string) =>
    mail.records.filter((it) => it.to === email.toLowerCase());

  it("files an existing account's invitation in the bell and mails it once", async ({
    expect,
  }) => {
    const invitee = await createUser("invitee");

    const { project } = await invite(invitee.email);

    const rows = await probe.inbox.findMany({
      where: { userId: { eq: invitee.id } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "Invitation to join Invited",
      href: "/account/invitations",
      scope: `project:${project.id}`,
      scopeLabel: "Invited",
      template: "lore:invitation:received",
      category: "invitations",
    });
    expect(JSON.stringify(rows[0])).not.toContain("invitation=");

    const mails = mailsTo(invitee.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe("You have been invited to a project");
    expect(mails[0].body).toContain(
      "https://lore.test/auth/register?invitation=",
    );
  });

  it("only mails an address with no account", async ({ expect }) => {
    const email = "stranger@example.com";

    await invite(email);

    expect(await probe.inbox.findMany({})).toEqual([]);
    expect(mailsTo(email)).toHaveLength(1);
    // Nothing queued at all: no skipped receipt per stranger.
    expect(
      (await probe.executions.findMany({})).filter((it) =>
        JSON.stringify(it.payload).includes("lore:invitation:received"),
      ),
    ).toEqual([]);
  });

  it("mutes the bell without muting the email", async ({ expect }) => {
    const invitee = await createUser("invitee");
    await probe.preferences.create({
      userId: invitee.id,
      mutedCategories: ["invitations"],
    });

    await invite(invitee.email);

    expect(await probe.inbox.findMany({})).toEqual([]);
    expect(mailsTo(invitee.email)).toHaveLength(1);
  });

  it("names the template explicitly and declares its French", ({ expect }) => {
    const { invitationInbox } = notifications;

    // That string is written into ninety days of receipts.
    expect(invitationInbox.name).toBe("lore:invitation:received");
    expect(invitationInbox.options.translations?.fr?.inbox).toBeDefined();
  });
});
