import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import { $channel } from "../primitives/$channel.ts";

describe("$channel", () => {
  it("should create a channel primitive", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      chat = $channel({
        path: "/ws/chat",
        description: "Chat channel",
        schema: {
          in: z.object({
            type: z.const("message"),
            content: z.text(),
          }),
          out: z.object({
            content: z.text(),
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
});
