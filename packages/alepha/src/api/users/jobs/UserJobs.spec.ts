import { Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { $repository, AlephaOrm } from "alepha/orm";
import { describe, test } from "vitest";
import { sessions } from "../entities/sessions.ts";
import { users } from "../entities/users.ts";
import { UserJobs } from "./UserJobs.ts";

describe("UserJobs", () => {
  describe("purgeExpiredSessions", () => {
    test("should delete expired sessions", async ({ expect }) => {
      const alepha = Alepha.create().with(AlephaOrm).with(AlephaApiJobs);

      class TestRepositories {
        userRepository = $repository(users);
        sessionRepository = $repository(sessions);
      }

      const userJobs = alepha.inject(UserJobs);
      const repos = alepha.inject(TestRepositories);
      await alepha.start();

      // Create a test user
      const user = await repos.userRepository.create({
        email: "test@example.com",
      });

      // Create expired sessions (expiresAt in the past)
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: pastDate,
      });
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: pastDate,
      });

      // Create a valid session (expiresAt in the future)
      const futureDate = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString(); // 1 day from now
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: futureDate,
      });

      // Verify we have 3 sessions
      const sessionsBefore = await repos.sessionRepository.findMany();
      expect(sessionsBefore).toHaveLength(3);

      // Trigger the job
      await userJobs.purgeExpiredSessions.trigger();

      // Verify only the valid session remains
      const sessionsAfter = await repos.sessionRepository.findMany();
      expect(sessionsAfter).toHaveLength(1);
      expect(new Date(sessionsAfter[0].expiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    test("should handle case when no expired sessions exist", async ({
      expect,
    }) => {
      const alepha = Alepha.create().with(AlephaOrm).with(AlephaApiJobs);

      class TestRepositories {
        userRepository = $repository(users);
        sessionRepository = $repository(sessions);
      }

      const userJobs = alepha.inject(UserJobs);
      const repos = alepha.inject(TestRepositories);
      await alepha.start();

      // Create a test user
      const user = await repos.userRepository.create({
        email: "test2@example.com",
      });

      // Create only valid sessions
      const futureDate = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: futureDate,
      });

      // Verify we have 1 session
      const sessionsBefore = await repos.sessionRepository.findMany();
      expect(sessionsBefore).toHaveLength(1);

      // Trigger the job - should not throw
      await userJobs.purgeExpiredSessions.trigger();

      // Session should still exist
      const sessionsAfter = await repos.sessionRepository.findMany();
      expect(sessionsAfter).toHaveLength(1);
    });
  });
});
