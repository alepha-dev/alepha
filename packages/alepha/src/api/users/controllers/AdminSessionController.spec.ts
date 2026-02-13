import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { DbEntityNotFoundError } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { describe, it } from "vitest";
import {
  AdminSessionController,
  AlephaApiUsers,
  SessionCrudService,
  UserService,
} from "../index.ts";

const adminUser: UserAccountToken = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Test Admin",
  roles: ["admin"],
};

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);

  await alepha.start();

  return {
    alepha,
    sessionService: alepha.inject(SessionCrudService),
    userService: alepha.inject(UserService),
    controller: alepha.inject(AdminSessionController),
    dateTimeProvider: alepha.inject(DateTimeProvider),
  };
};

describe("alepha/api/users - AdminSessionController", () => {
  it("should get a session by ID", async ({ expect }) => {
    const { sessionService, userService, controller, dateTimeProvider } =
      await setup();

    // Create a test user
    const user = await userService.users().create({
      username: "sessionuser",
      email: "session@example.com",
      roles: ["user"],
    });

    // Create a session
    const session = await sessionService.sessions().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
      ip: "127.0.0.1",
      userAgent: {
        os: "macOS",
        browser: "Chrome",
        device: "DESKTOP",
      },
    });

    const result = await controller.getSession(
      {
        params: { id: session.id },
      },
      { user: adminUser },
    );

    expect(result.id).toBe(session.id);
    expect(result.userId).toBe(user.id);
    expect(result.ip).toBe("127.0.0.1");
    expect(result.userAgent?.browser).toBe("Chrome");
  });

  it("should throw error for non-existent session", async ({ expect }) => {
    const { controller } = await setup();

    await expect(
      controller.getSession(
        {
          params: { id: "550e8400-e29b-41d4-a716-446655440000" },
        },
        { user: adminUser },
      ),
    ).rejects.toThrowError(DbEntityNotFoundError);
  });

  it("should delete a session", async ({ expect }) => {
    const { sessionService, userService, controller, dateTimeProvider } =
      await setup();

    const user = await userService.users().create({
      username: "deletesessionuser",
      email: "deletesession@example.com",
      roles: ["user"],
    });

    const session = await sessionService.sessions().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });

    const result = await controller.deleteSession(
      {
        params: { id: session.id },
      },
      { user: adminUser },
    );

    expect(result.ok).toBe(true);
    expect(result.id).toBe(session.id);

    // Verify session is deleted
    await expect(
      controller.getSession(
        {
          params: { id: session.id },
        },
        { user: adminUser },
      ),
    ).rejects.toThrowError(DbEntityNotFoundError);
  });

  it("should find sessions with pagination", async ({ expect }) => {
    const { sessionService, userService, controller, dateTimeProvider } =
      await setup();

    const user = await userService.users().create({
      username: "multisessionuser",
      email: "multisession@example.com",
      roles: ["user"],
    });

    // Create multiple sessions
    const session1 = await sessionService.sessions().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });
    const session2 = await sessionService.sessions().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });
    const session3 = await sessionService.sessions().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });

    const result = await controller.findSessions(
      {
        query: { userId: user.id },
      },
      { user: adminUser },
    );

    expect(result.content.length).toBeGreaterThanOrEqual(3);

    // Verify all created sessions are in the results
    const sessionIds = result.content.map((s) => s.id);
    expect(sessionIds).toContain(session1.id);
    expect(sessionIds).toContain(session2.id);
    expect(sessionIds).toContain(session3.id);
  });

  it("should filter sessions by userId", async ({ expect }) => {
    const { sessionService, userService, controller, dateTimeProvider } =
      await setup();

    const user1 = await userService.users().create({
      username: "user1",
      email: "user1@example.com",
      roles: ["user"],
    });
    const user2 = await userService.users().create({
      username: "user2",
      email: "user2@example.com",
      roles: ["user"],
    });

    await sessionService.sessions().create({
      userId: user1.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });
    await sessionService.sessions().create({
      userId: user1.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });
    await sessionService.sessions().create({
      userId: user2.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });

    const result = await controller.findSessions(
      {
        query: { userId: user1.id },
      },
      { user: adminUser },
    );

    expect(result.content.every((s) => s.userId === user1.id)).toBe(true);
    expect(result.content.length).toBeGreaterThanOrEqual(2);
  });

  it("should sort sessions by creation date (newest first)", async ({
    expect,
  }) => {
    const { sessionService, userService, controller, dateTimeProvider } =
      await setup();

    const user = await userService.users().create({
      username: "sorttestuser",
      email: "sorttest@example.com",
      roles: ["user"],
    });

    const session1 = await sessionService.sessions().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });
    const session2 = await sessionService.sessions().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });
    const session3 = await sessionService.sessions().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
    });

    const result = await controller.findSessions(
      {
        query: { userId: user.id },
      },
      { user: adminUser },
    );

    const sessionIds = result.content.map((s) => s.id);
    expect(sessionIds.indexOf(session3.id)).toBeLessThan(
      sessionIds.indexOf(session2.id),
    );
    expect(sessionIds.indexOf(session2.id)).toBeLessThan(
      sessionIds.indexOf(session1.id),
    );
  });

  it("should handle sessions with different user agents", async ({
    expect,
  }) => {
    const { sessionService, userService, controller, dateTimeProvider } =
      await setup();

    const user = await userService.users().create({
      username: "useragentuser",
      email: "useragent@example.com",
      roles: ["user"],
    });

    const desktopSession = await sessionService.sessions().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
      userAgent: {
        os: "Windows",
        browser: "Edge",
        device: "DESKTOP",
      },
    });

    const mobileSession = await sessionService.sessions().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt: dateTimeProvider.now().add(7, "days").toISOString(),
      userAgent: {
        os: "iOS",
        browser: "Safari",
        device: "MOBILE",
      },
    });

    const desktopResult = await controller.getSession(
      {
        params: { id: desktopSession.id },
      },
      { user: adminUser },
    );
    expect(desktopResult.userAgent?.device).toBe("DESKTOP");
    expect(desktopResult.userAgent?.browser).toBe("Edge");

    const mobileResult = await controller.getSession(
      {
        params: { id: mobileSession.id },
      },
      { user: adminUser },
    );
    expect(mobileResult.userAgent?.device).toBe("MOBILE");
    expect(mobileResult.userAgent?.browser).toBe("Safari");
  });
});
