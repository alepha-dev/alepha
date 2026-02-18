import { Alepha } from "alepha";
import { describe, it } from "vitest";
import {
  testCombiningStringOperators,
  testContainsOperator,
  testEndsWithOperator,
  testStartsWithOperator,
  testStringOperatorsEscapeWildcards,
  testStringOperatorsOptionalFields,
  testStringOperatorsSpecialChars,
  testWildcardInjectionPrevention,
} from "./string-operators-tests.ts";

describe("string-operators", () => {
  describe("contains", () => {
    it("should perform case insensitive substring matching (sqlite)", async () => {
      await testContainsOperator(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should perform case insensitive substring matching (postgres)", async () => {
      await testContainsOperator(Alepha.create());
    });
  });

  describe("startsWith", () => {
    it("should perform case insensitive prefix matching (sqlite)", async () => {
      await testStartsWithOperator(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should perform case insensitive prefix matching (postgres)", async () => {
      await testStartsWithOperator(Alepha.create());
    });
  });

  describe("endsWith", () => {
    it("should perform case insensitive suffix matching (sqlite)", async () => {
      await testEndsWithOperator(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should perform case insensitive suffix matching (postgres)", async () => {
      await testEndsWithOperator(Alepha.create());
    });
  });

  describe("combining operators", () => {
    it("should combine string operators with other filters (sqlite)", async () => {
      await testCombiningStringOperators(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should combine string operators with other filters (postgres)", async () => {
      await testCombiningStringOperators(Alepha.create());
    });
  });

  describe("special characters", () => {
    it("should handle special characters (sqlite)", async () => {
      await testStringOperatorsSpecialChars(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should handle special characters (postgres)", async () => {
      await testStringOperatorsSpecialChars(Alepha.create());
    });
  });

  describe("optional fields", () => {
    it("should work on optional fields (sqlite)", async () => {
      await testStringOperatorsOptionalFields(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should work on optional fields (postgres)", async () => {
      await testStringOperatorsOptionalFields(Alepha.create());
    });
  });

  describe("SQL wildcard escaping", () => {
    it("should properly escape SQL wildcards (sqlite)", async () => {
      await testStringOperatorsEscapeWildcards(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should properly escape SQL wildcards (postgres)", async () => {
      await testStringOperatorsEscapeWildcards(Alepha.create());
    });
  });

  describe("wildcard injection", () => {
    it("should prevent wildcard injection (sqlite)", async () => {
      await testWildcardInjectionPrevention(
        Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      );
    });
    it("should prevent wildcard injection (postgres)", async () => {
      await testWildcardInjectionPrevention(Alepha.create());
    });
  });
});
