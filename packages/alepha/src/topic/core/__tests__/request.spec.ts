import { AbortedError, Alepha, AlephaError, TimeoutError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import { $subscriber } from "../primitives/$subscriber.ts";
import { $topic } from "../primitives/$topic.ts";
import { MemoryTopicProvider } from "../providers/MemoryTopicProvider.ts";
import { TopicProvider } from "../providers/TopicProvider.ts";

class InspectableTopicProvider extends MemoryTopicProvider {
  public get pending(): number {
    return this.pendingReplies.size;
  }
}

const commandSchema = z.object({ action: z.text() });
const resultSchema = z.object({ ok: z.boolean(), action: z.text() });

class Commands {
  plain: string[] = [];

  command = $topic({
    name: "cmd/{device}",
    schema: {
      params: z.object({ device: z.text() }),
      payload: commandSchema,
      response: resultSchema,
    },
    handler: async ({ params, payload }) => {
      this.plain.push(`${params.device}:${payload.action}`);
      if (payload.action === "explode") {
        throw new Error("responder failed");
      }
      if (payload.action === "invalid") {
        return { ok: "yes" };
      }
      return { ok: true, action: `${payload.action}@${params.device}` };
    },
  });

  silent = $topic({
    name: "silent",
    schema: { payload: commandSchema, response: resultSchema },
  });

  notify = $topic({
    name: "notify",
    schema: { payload: commandSchema },
  });
}

const setup = async () => {
  const alepha = Alepha.create()
    .with({ provide: TopicProvider, use: InspectableTopicProvider })
    .with(Commands);
  const provider = alepha.inject(InspectableTopicProvider);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();
  return { alepha, provider, dateTime, commands: alepha.inject(Commands) };
};

/**
 * Lets a `request()` reach its deadline: it subscribes to its reply channel
 * before arming the timer, all in microtasks.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("$topic request/response", () => {
  it("resolves with the responder's typed reply, and leaves no pending entry", async ({
    expect,
  }) => {
    const { commands, provider } = await setup();

    const result = await commands.command.request({
      params: { device: "tvm-1" },
      payload: { action: "reboot" },
    });

    expect(result).toEqual({ ok: true, action: "reboot@tvm-1" });
    expect(provider.pending).toBe(0);
  });

  it("is a type error on a topic without a response schema", async ({
    expect,
  }) => {
    const { commands } = await setup();

    await expect(
      // @ts-expect-error: `notify` declares no `response`.
      commands.notify.request({ action: "x" }),
    ).rejects.toThrow(AlephaError);
  });

  it("handles a plain publish on a response topic and sends nothing back", async ({
    expect,
  }) => {
    const { commands, provider } = await setup();

    await commands.command.publish({
      params: { device: "d" },
      payload: { action: "ping" },
    });

    expect(commands.plain).toEqual(["d:ping"]);
    expect(provider.pending).toBe(0);
  });

  it("times out with the 503 TimeoutError under travel(), and leaves no pending entry", async ({
    expect,
  }) => {
    const { commands, provider, dateTime } = await setup();
    dateTime.pause();

    const settled = commands.silent
      .request({ action: "nobody" }, { timeout: [5, "seconds"] })
      .catch((error: unknown) => error);
    await settle();
    expect(provider.pending).toBe(1);
    await dateTime.travel([5, "seconds"]);

    const error = await settled;
    expect(error).toBeInstanceOf(TimeoutError);
    expect(provider.pending).toBe(0);
  });

  it("times out when the responder throws or returns what the schema refuses", async ({
    expect,
  }) => {
    const { commands, provider, dateTime } = await setup();
    dateTime.pause();

    const thrown = commands.command
      .request({ params: { device: "a" }, payload: { action: "explode" } })
      .catch((error: unknown) => error);
    const refused = commands.command
      .request({ params: { device: "a" }, payload: { action: "invalid" } })
      .catch((error: unknown) => error);
    await settle();
    await dateTime.travel([10, "seconds"]);

    expect(await thrown).toBeInstanceOf(TimeoutError);
    expect(await refused).toBeInstanceOf(TimeoutError);
    expect(provider.pending).toBe(0);
  });

  it("rejects with the abort's reason on an ambient abort, and leaves no pending entry", async ({
    expect,
  }) => {
    const { alepha, commands, provider } = await setup();
    const parent = new AbortController();

    const settled = alepha.context.run(() =>
      alepha.context.withSignal(parent.signal, () =>
        commands.silent
          .request({ action: "abandoned" })
          .catch((error: unknown) => error),
      ),
    );
    await settle();
    expect(provider.pending).toBe(1);
    parent.abort(new AbortedError("Client disconnected"));

    expect(await settled).toBeInstanceOf(AbortedError);
    expect(provider.pending).toBe(0);
  });

  it("settles on the first reply when several responders answer", async ({
    expect,
  }) => {
    class Racing {
      ask = $topic({
        name: "ask",
        schema: { payload: commandSchema, response: resultSchema },
      });

      first = $subscriber({
        topic: this.ask,
        handler: async () => ({ ok: true, action: "first" }),
      });

      second = $subscriber({
        topic: this.ask,
        handler: async () => ({ ok: true, action: "second" }),
      });
    }

    const alepha = Alepha.create()
      .with({ provide: TopicProvider, use: InspectableTopicProvider })
      .with(Racing);
    const provider = alepha.inject(InspectableTopicProvider);
    await alepha.start();

    const result = await alepha.inject(Racing).ask.request({ action: "who" });

    expect(result).toEqual({ ok: true, action: "first" });
    expect(provider.pending).toBe(0);
  });
});
