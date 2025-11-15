import { Alepha, t } from "@alepha/core";
import { test } from "vitest";
import { $channel } from "../src/descriptors/$channel.ts";

test("$channel should create a channel descriptor", async ({ expect }) => {
  const alepha = Alepha.create();

  class TestApp {
    chat = $channel({
      path: "/ws/chat",
      description: "Chat channel",
      schema: {
        in: t.object({
          type: t.const("message"),
          content: t.text(),
        }),
        out: t.object({
          content: t.text(),
        }),
      },
    });
  }

  const app = alepha.inject(TestApp);

  expect(app.chat).toBeDefined();
  expect(app.chat.options.path).toBe("/ws/chat");
  expect(app.chat.options.schema.in).toBeDefined();
  expect(app.chat.options.schema.out).toBeDefined();
});
