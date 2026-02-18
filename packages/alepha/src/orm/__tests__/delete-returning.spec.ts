import { Alepha } from "alepha";
import { describe, it } from "vitest";
import {
  testDeleteReturning,
  testSoftDeleteReturning,
} from "./delete-returning-tests.ts";

describe("delete-returning", () => {
  it("should return deleted IDs (sqlite)", async () => {
    await testDeleteReturning(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should return deleted IDs (postgres)", async () => {
    await testDeleteReturning(Alepha.create());
  });

  it("should handle soft delete with returning IDs (sqlite)", async () => {
    await testSoftDeleteReturning(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });
  it("should handle soft delete with returning IDs (postgres)", async () => {
    await testSoftDeleteReturning(Alepha.create());
  });
});
