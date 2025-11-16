import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { describe, it } from "vitest";
import { AlephaApiVerification } from "../../src/api-verifications";
import { verifications } from "../../src/api-verifications/entities/verifications.ts";
import { VerificationJobs } from "../../src/api-verifications/jobs/VerificationJobs.ts";

class Db {
  verifications = $repository(verifications);
}

const alepha = Alepha.create().with(AlephaApiVerification);
const db = alepha.inject(Db);

describe("VerificationJobs", () => {
  it("it should clear old verifications", async ({ expect }) => {
    const time = alepha.inject(DateTimeProvider);
    const jobs = alepha.inject(VerificationJobs);

    const entry = {
      type: "email",
      target: "hello@mail.com",
      code: "123456",
    } as const;

    await db.verifications.create({
      ...entry,
      createdAt: time.now().toISOString(),
    });

    await db.verifications.create({
      ...entry,
      createdAt: time.now().subtract(1, "days").toISOString(),
    });

    await db.verifications.create({
      ...entry,
      createdAt: time.now().subtract(2, "days").toISOString(),
    });

    expect(await db.verifications.count()).toBe(3);

    await jobs.cleanExpired.trigger();

    expect(await db.verifications.count()).toBe(1);
  });
});
