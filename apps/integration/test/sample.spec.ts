import { Alepha } from "@alepha/core";
import { test } from "vitest";

test("sample integration test", async ({ expect }) => {
  const alepha = Alepha.create();

  class TestApp {
    getValue() {
      return "integration-test";
    }
  }

  const app = alepha.inject(TestApp);
  await alepha.start();

  const result = app.getValue();
  expect(result).toBe("integration-test");
});
