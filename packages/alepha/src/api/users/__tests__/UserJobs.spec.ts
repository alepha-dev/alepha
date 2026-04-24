import { Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, test } from "vitest";
import { sessions } from "../entities/sessions.ts";
import { users } from "../entities/users.ts";
import { UserJobs } from "../jobs/UserJobs.ts";

describe("UserJobs", () => {
  describe("purgeExpiredSessions", () => {
    test("deletes expired sessions", async ({ expect }) => {
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);

      class TestRepositories {
        userRepository = $repository(users);
        sessionRepository = $repository(sessions);
      }

      const userJobs = alepha.inject(UserJobs);
      const repos = alepha.inject(TestRepositories);
      await alepha.start();

      const user = await repos.userRepository.create({
        email: "test@example.com",
      });

      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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

      const futureDate = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: futureDate,
      });

      expect(await repos.sessionRepository.findMany()).toHaveLength(3);

      // Cron jobs run inline — trigger awaits the handler synchronously.
      await userJobs.purgeExpiredSessions.trigger();

      const sessionsAfter = await repos.sessionRepository.findMany();
      expect(sessionsAfter).toHaveLength(1);
      expect(new Date(sessionsAfter[0].expiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    test("no-op when no expired sessions exist", async ({ expect }) => {
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);

      class TestRepositories {
        userRepository = $repository(users);
        sessionRepository = $repository(sessions);
      }

      const userJobs = alepha.inject(UserJobs);
      const repos = alepha.inject(TestRepositories);
      await alepha.start();

      const user = await repos.userRepository.create({
        email: "test2@example.com",
      });

      const futureDate = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();
      await repos.sessionRepository.create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: futureDate,
      });

      expect(await repos.sessionRepository.findMany()).toHaveLength(1);

      await userJobs.purgeExpiredSessions.trigger();

      expect(await repos.sessionRepository.findMany()).toHaveLength(1);
    });
  });
});
