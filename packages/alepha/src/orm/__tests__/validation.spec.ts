import { Alepha } from "alepha";
import { describe, it } from "vitest";
import {
  testBetweenValidation,
  testInArrayValidation,
  testNotBetweenValidation,
  testNotInArrayValidation,
} from "./validation-tests.ts";

describe("validation", () => {
  describe("between operator", () => {
    it("should validate between requires exactly 2 values (sqlite)", async () => {
      await testBetweenValidation(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should validate between requires exactly 2 values (postgres)", async () => {
      await testBetweenValidation(Alepha.create());
    });
  });

  describe("notBetween operator", () => {
    it("should validate notBetween requires exactly 2 values (sqlite)", async () => {
      await testNotBetweenValidation(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should validate notBetween requires exactly 2 values (postgres)", async () => {
      await testNotBetweenValidation(Alepha.create());
    });
  });

  describe("inArray operator", () => {
    it("should validate inArray requires at least one value (sqlite)", async () => {
      await testInArrayValidation(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should validate inArray requires at least one value (postgres)", async () => {
      await testInArrayValidation(Alepha.create());
    });
  });

  describe("notInArray operator", () => {
    it("should validate notInArray requires at least one value (sqlite)", async () => {
      await testNotInArrayValidation(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should validate notInArray requires at least one value (postgres)", async () => {
      await testNotInArrayValidation(Alepha.create());
    });
  });
});
