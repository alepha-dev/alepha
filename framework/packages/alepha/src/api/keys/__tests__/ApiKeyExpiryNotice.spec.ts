import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { jobExecutionEntity } from "alepha/api/jobs";
import {
  AlephaApiNotifications,
  NotificationJobs,
} from "alepha/api/notifications";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { $issuer, AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { users } from "../../users/entities/users.ts";
import { apiKeyEntity } from "../entities/apiKeyEntity.ts";
import { AlephaApiKeys } from "../index.ts";
import { ApiKeyNotifications } from "../notifications/ApiKeyNotifications.ts";
import { apiKeyOptions } from "../parameters/ApiKeyParameters.ts";
import { ApiKeyService } from "../services/ApiKeyService.ts";

const DAY = 24 * 60 * 60 * 1000;

class TestApp {
  users = $repository(users);
  keys = $repository(apiKeyEntity);
  executions = $repository(jobExecutionEntity);
  issuer = $issuer({
    secret: "test-secret",
    roles: [{ name: "admin", permissions: [{ name: "*" }] }],
  });
}

const setup = async (options: { notifications: boolean }) => {
  const alepha = Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaApiKeys);
  if (options.notifications) {
    alepha
      .with(AlephaEmail)
      .with(AlephaApiNotifications)
      .with(ApiKeyNotifications);
  }
  const app = alepha.inject(TestApp);
  const service = alepha.inject(ApiKeyService);
  const time = alepha.inject(DateTimeProvider);
  await alepha.start();
  time.pause();

  const owner = await app.users.create({
    id: randomUUID(),
    email: `owner-${randomUUID().slice(0, 8)}@example.com`,
    username: `owner-${randomUUID().slice(0, 8)}`,
  });

  const noticesFor = async (keyName: string) => {
    const jobName = alepha.inject(NotificationJobs).sendNotification.name;
    const rows = await app.executions.findMany({
      where: { jobName: { eq: jobName } },
    });
    return rows.filter(
      (row) =>
        (row.payload as { variables?: { name?: string } } | undefined)
          ?.variables?.name === keyName,
    );
  };

  return { alepha, app, service, time, owner, noticesFor };
};

describe("the API key expiry notice", () => {
  it("tells the owner once across the whole warning window", async () => {
    const { app, service, time, owner, noticesFor } = await setup({
      notifications: true,
    });
    const name = `expiring ${randomUUID().slice(0, 8)}`;

    const { apiKey } = await service.create({
      userId: owner.id,
      name,
      roles: [],
      expiresAt: new Date(time.nowMillis() + 5 * DAY),
    });

    // Several daily runs inside the seven-day window.
    for (let day = 0; day < 4; day++) {
      await service.notifyExpiring();
      await time.travel(1, "day");
    }

    const notices = await noticesFor(name);
    expect(notices).toHaveLength(1);
    expect(notices[0].payload).toMatchObject({
      contact: owner.email,
      variables: { name, tokenSuffix: apiKey.tokenSuffix, daysLeft: 5 },
    });
    expect(
      (await app.keys.getById(apiKey.id)).expiryNoticeSentAt,
    ).toBeDefined();
  });

  it("leaves a key outside the window, or already revoked, alone", async () => {
    const { service, time, owner, noticesFor } = await setup({
      notifications: true,
    });
    const far = `far ${randomUUID().slice(0, 8)}`;
    const revoked = `revoked ${randomUUID().slice(0, 8)}`;

    await service.create({
      userId: owner.id,
      name: far,
      roles: [],
      expiresAt: new Date(time.nowMillis() + 30 * DAY),
    });
    const dead = await service.create({
      userId: owner.id,
      name: revoked,
      roles: [],
      expiresAt: new Date(time.nowMillis() + 2 * DAY),
    });
    await service.revoke(dead.apiKey.id, owner.id);

    await service.notifyExpiring();

    expect(await noticesFor(far)).toHaveLength(0);
    expect(await noticesFor(revoked)).toHaveLength(0);
  });

  it("clears the marker on rotation, so the new expiry gets its own notice", async () => {
    const { app, service, time, owner } = await setup({ notifications: true });

    const { apiKey } = await service.create({
      userId: owner.id,
      name: `rotated ${randomUUID().slice(0, 8)}`,
      roles: [],
      expiresAt: new Date(time.nowMillis() + 3 * DAY),
    });
    await service.notifyExpiring();
    expect(
      (await app.keys.getById(apiKey.id)).expiryNoticeSentAt,
    ).toBeDefined();

    await service.rotate(apiKey.id, owner.id, { expiresIn: "7d" });

    expect(
      (await app.keys.getById(apiKey.id)).expiryNoticeSentAt,
    ).toBeUndefined();
  });

  it("does nothing, and marks nothing, when the notifications module is absent", async () => {
    const { app, service, time, owner } = await setup({ notifications: false });

    const { apiKey } = await service.create({
      userId: owner.id,
      name: `no mailer ${randomUUID().slice(0, 8)}`,
      roles: [],
      expiresAt: new Date(time.nowMillis() + 2 * DAY),
    });

    expect(await service.notifyExpiring()).toBe(0);
    expect(
      (await app.keys.getById(apiKey.id)).expiryNoticeSentAt,
    ).toBeUndefined();
  });

  it("does nothing when expiryWarningDays is 0", async () => {
    const { alepha, service, time, owner, noticesFor } = await setup({
      notifications: true,
    });
    alepha.store.set(apiKeyOptions, {
      ...alepha.store.get(apiKeyOptions),
      expiryWarningDays: 0,
    });
    const name = `silenced ${randomUUID().slice(0, 8)}`;

    await service.create({
      userId: owner.id,
      name,
      roles: [],
      expiresAt: new Date(time.nowMillis() + DAY),
    });

    expect(await service.notifyExpiring()).toBe(0);
    expect(await noticesFor(name)).toHaveLength(0);
  });
});
