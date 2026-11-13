import { Alepha } from "alepha";
import { AiProvider, MemoryAiProvider } from "alepha/ai";
import { AnthropicAiProvider } from "alepha/ai/anthropic";
import { AiController, AiSettings } from "alepha/api/ai";
import { describe, it } from "vitest";

import {
  LoreAiAssistant,
  LoreAiController,
  LoreAssistant,
} from "@/assistant/index.ts";

import { bootAssistant } from "./fixtures/bootAssistant.ts";
import { bootLore } from "./fixtures/bootLore.ts";

/**
 * The assistant's module (#Q3207): registered on every copy, answering only
 * where `AI_ASSISTANT_ENABLED` is set, to signed-in callers, within the
 * `api.ai` budget Lore sets.
 */
describe("LoreAssistant", () => {
  it("substitutes Lore's controller and Lore's api.ai defaults", async ({
    expect,
  }) => {
    const { alepha } = await bootAssistant();
    expect(alepha.inject(AiController)).toBeInstanceOf(LoreAiController);
    expect(alepha.inject(AiSettings).current).toEqual({
      budgetTokens: 200_000,
      budgetWindowHours: 24,
      turnsPerMinute: 20,
      retentionDays: 30,
    });
    await alepha.stop();
  });

  describe("AI_ASSISTANT_ENABLED unset", () => {
    it("answers 404 on chat, resume, list and detail, and reports itself off", async ({
      expect,
    }) => {
      const { alepha, controller, status, signIn } = await bootAssistant();
      const { headers, user } = await signIn();
      const id = crypto.randomUUID();

      const chat = await controller.chat.fetch({
        headers,
        body: { message: "hello" },
      });
      expect(chat.status).toBe(404);
      const resume = await controller.resume.fetch({
        headers,
        params: { id },
        body: { callId: "c1", decision: "approve" },
      });
      expect(resume.status).toBe(404);
      await expect(
        controller.listConversations.fetch({}, { request: { headers } }),
      ).rejects.toThrow(/not found/i);
      await expect(
        controller.getConversation.fetch(
          { params: { id } },
          { request: { headers } },
        ),
      ).rejects.toThrow(/not found/i);

      expect(await status.aiAssistantStatus.run({}, { user })).toEqual({
        enabled: false,
      });
      await alepha.stop();
    });

    it.for(["", "false", "0"])(
      "stays off for the value %j",
      async (value, { expect }) => {
        const { alepha, status, signIn } = await bootAssistant({
          enabled: value,
        });
        const { user } = await signIn();
        expect(await status.aiAssistantStatus.run({}, { user })).toEqual({
          enabled: false,
        });
        await alepha.stop();
      },
    );
  });

  describe("AI_ASSISTANT_ENABLED set", () => {
    it("streams a turn for a signed-in user and reports itself on", async ({
      expect,
    }) => {
      const { alepha, controller, status, signIn, read, ai } =
        await bootAssistant({ enabled: "true" });
      const { headers, user } = await signIn();
      ai.script([{ type: "text", text: "Hello." }]);

      const res = await controller.chat.fetch({
        headers,
        body: { message: "hi" },
      });
      expect(res.status).toBe(200);
      const events = await read(res);
      expect(events.at(-1)).toEqual({ type: "end", reason: "stop" });

      const list = await controller.listConversations.fetch(
        {},
        { request: { headers } },
      );
      expect(list.data).toHaveLength(1);
      expect(await status.aiAssistantStatus.run({}, { user })).toEqual({
        enabled: true,
      });
      await alepha.stop();
    });

    it("refuses a signed-out caller with a 401", async ({ expect }) => {
      const { alepha, controller, status } = await bootAssistant({
        enabled: "true",
      });
      const res = await controller.chat.fetch({ body: { message: "hi" } });
      expect(res.status).toBe(401);
      await expect(status.aiAssistantStatus.fetch({})).rejects.toThrow();
      await alepha.stop();
    });

    it("refuses a turn once the user spent the 200k-token budget", async ({
      expect,
    }) => {
      const { alepha, controller, signIn, read, ai } = await bootAssistant({
        enabled: "true",
      });
      const { headers } = await signIn();
      ai.script([
        { type: "text", text: "A long answer." },
        { type: "usage", inputTokens: 150_000, outputTokens: 50_001 },
      ]);
      await read(
        await controller.chat.fetch({ headers, body: { message: "first" } }),
      );

      const over = await controller.chat.fetch({
        headers,
        body: { message: "second" },
      });
      expect(over.status).toBe(429);
      await alepha.stop();
    });
  });

  describe("the vendor, picked by the env", () => {
    it("answers on Anthropic, with AI_MODEL, when AI_API_KEY is set", async ({
      expect,
    }) => {
      const { alepha } = await bootAssistant({
        enabled: "1",
        env: { AI_API_KEY: "sk-ant-test", AI_MODEL: "claude-sonnet-5-5" },
      });
      expect(alepha.inject(AiProvider)).toBeInstanceOf(AnthropicAiProvider);
      expect(alepha.inject(LoreAiAssistant).assistant.options.model).toBe(
        "claude-sonnet-5-5",
      );
      await alepha.stop();
    });

    it("refuses to start on Anthropic without AI_MODEL", async ({ expect }) => {
      await expect(
        bootAssistant({ enabled: "1", env: { AI_API_KEY: "sk-ant-test" } }),
      ).rejects.toThrow(/AI_MODEL/);
    });

    it("keeps the Workers AI default model without a key", async ({
      expect,
    }) => {
      const { alepha } = await bootAssistant();
      expect(alepha.inject(AiProvider)).toBeInstanceOf(MemoryAiProvider);
      expect(alepha.inject(LoreAiAssistant).assistant.options.model).toBe(
        "@cf/mistralai/mistral-small-3.1-24b-instruct",
      );
      await alepha.stop();
    });

    it("lets AI_MODEL replace the default model without a key", async ({
      expect,
    }) => {
      const { alepha } = await bootAssistant({
        env: { AI_MODEL: "@cf/meta/llama-4-scout-17b-16e-instruct" },
      });
      expect(alepha.inject(LoreAiAssistant).assistant.options.model).toBe(
        "@cf/meta/llama-4-scout-17b-16e-instruct",
      );
      await alepha.stop();
    });
  });

  describe("on a production copy off Workers", () => {
    it("refuses to boot with the switch set and only the in-memory provider", async ({
      expect,
    }) => {
      const alepha = Alepha.create({
        env: {
          DATABASE_URL: ":memory:",
          SERVER_PORT: 0,
          NODE_ENV: "production",
          APP_SECRET: "a-test-secret-that-is-long-enough-for-production",
          // Production applies migrations, read relative to the working
          // directory: off here, so the spec runs from any folder.
          DATABASE_SYNC: false,
          AI_ASSISTANT_ENABLED: "1",
        },
      });
      bootLore(alepha, ["api", "mcp"]);
      alepha.with(LoreAssistant);
      await expect(alepha.start()).rejects.toThrow(/AI_ASSISTANT_ENABLED/);
    });

    it("does not refuse to boot with the switch unset", async ({ expect }) => {
      const alepha = Alepha.create({
        env: {
          DATABASE_URL: ":memory:",
          SERVER_PORT: 0,
          NODE_ENV: "production",
          APP_SECRET: "a-test-secret-that-is-long-enough-for-production",
          // Production applies migrations, read relative to the working
          // directory: off here, so the spec runs from any folder.
          DATABASE_SYNC: false,
        },
      });
      bootLore(alepha, ["api", "mcp"]);
      alepha.with(LoreAssistant);
      const failure = await alepha.start().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure instanceof Error ? failure.message : "").not.toMatch(
        /AI_ASSISTANT_ENABLED/,
      );
      await alepha.stop();
    });
  });
});
