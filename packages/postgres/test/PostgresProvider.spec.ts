import { Alepha } from "@alepha/core";
import { describe, expect, it } from "vitest";
import { $repository, AlephaPostgres } from "../src";
import { userEntity } from "./fixtures/userEntitySchema.ts";

describe("PostgresProvider", () => {
  it("should handle basic CRUD operations with timestamps", async () => {
    class UserService {
      users = $repository(userEntity);
    }

    const alepha = Alepha.create().with(AlephaPostgres);

    const userService = alepha.inject(UserService);

    await alepha.start();

    await userService.users.create({
      name: "John",
      profile: {
        age: 30,
      },
    });

    const [r1] = await userService.users.find({
      where: { name: { eq: "John" } },
    });

    expect(r1.name).toEqual("John");
    expect(r1.createdAt.toISOString()).toBe(r1.updatedAt.toISOString());

    await new Promise((resolve) => setTimeout(resolve, 1));

    const r2 = await userService.users.updateOne(
      { name: { eq: "John" } },
      {
        profile: { age: 31 },
      },
    );

    expect(r2.name).toEqual("John");
    expect(r2.profile.age).toEqual(31);
    expect(r2.createdAt.toISOString()).toBe(r1.createdAt.toISOString());
    expect(r2.updatedAt.toISOString()).not.toBe(r1.updatedAt.toISOString());
  });
});
