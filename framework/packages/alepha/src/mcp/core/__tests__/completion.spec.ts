import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import {
  $prompt,
  $resourceTemplate,
  AlephaMcp,
  McpServerProvider,
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

const LANGUAGES = ["python", "php", "perl", "typescript", "rust"];

const complete = async (alepha: Alepha, params: Record<string, unknown>) =>
  alepha.inject(McpServerProvider).handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "completion/complete",
    params,
  });

describe("completion/complete", () => {
  class Prompts {
    review = $prompt({
      description: "Review some code",
      args: z.object({ language: z.text(), file: z.text() }),
      handler: async ({ args }) => [
        { role: "user", content: `Review this ${args.language}` },
      ],
      complete: async ({ argument }) =>
        argument.name === "language"
          ? LANGUAGES.filter((l) => l.startsWith(argument.value))
          : [],
    });
  }

  const start = async () => {
    const alepha = Alepha.create().with(AlephaMcp).with(Prompts);
    await alepha.start();
    return alepha;
  };

  it("returns candidates for a prompt argument", async () => {
    const alepha = await start();

    const response = await complete(alepha, {
      ref: { type: "ref/prompt", name: "review" },
      argument: { name: "language", value: "p" },
    });
    const result = response?.result as {
      completion: { values: string[]; total: number; hasMore: boolean };
    };

    expect(result.completion.values).toEqual(["python", "php", "perl"]);
    expect(result.completion.total).toBe(3);
    expect(result.completion.hasMore).toBe(false);
  });

  it("returns an empty list for an argument the handler does not know", async () => {
    const alepha = await start();

    const response = await complete(alepha, {
      ref: { type: "ref/prompt", name: "review" },
      argument: { name: "file", value: "x" },
    });
    const result = response?.result as { completion: { values: string[] } };

    expect(result.completion.values).toEqual([]);
  });

  it("caps results and reports hasMore with the real total", async () => {
    class ManyPrompts {
      pick = $prompt({
        args: z.object({ n: z.text() }),
        handler: async () => [],
        complete: async () =>
          Array.from({ length: 250 }, (_, i) => `option-${i}`),
      });
    }

    const alepha = Alepha.create().with(AlephaMcp).with(ManyPrompts);
    await alepha.start();

    const response = await complete(alepha, {
      ref: { type: "ref/prompt", name: "pick" },
      argument: { name: "n", value: "" },
    });
    const result = response?.result as {
      completion: { values: string[]; total: number; hasMore: boolean };
    };

    expect(result.completion.values).toHaveLength(100);
    expect(result.completion.total).toBe(250);
    expect(result.completion.hasMore).toBe(true);
  });

  it("passes already-filled arguments to the handler", async () => {
    let seen: Record<string, string> | undefined;

    class ScopedPrompts {
      place = $prompt({
        args: z.object({ country: z.text(), city: z.text() }),
        handler: async () => [],
        complete: async ({ arguments: filled }) => {
          seen = filled;
          return filled?.country === "fr" ? ["Paris", "Lyon"] : [];
        },
      });
    }

    const alepha = Alepha.create().with(AlephaMcp).with(ScopedPrompts);
    await alepha.start();

    const response = await complete(alepha, {
      ref: { type: "ref/prompt", name: "place" },
      argument: { name: "city", value: "" },
      context: { arguments: { country: "fr" } },
    });
    const result = response?.result as { completion: { values: string[] } };

    expect(seen).toEqual({ country: "fr" });
    expect(result.completion.values).toEqual(["Paris", "Lyon"]);
  });

  it("completes a resource template's URI variables", async () => {
    class Templates {
      folio = $resourceTemplate({
        uriTemplate: "folio://{projectId}",
        variables: z.object({ projectId: z.text() }),
        handler: async () => ({ text: "" }),
        complete: async ({ argument }) =>
          ["1", "2", "13"].filter((id) => id.startsWith(argument.value)),
      });
    }

    const alepha = Alepha.create().with(AlephaMcp).with(Templates);
    await alepha.start();

    const response = await complete(alepha, {
      ref: { type: "ref/resource", uri: "folio://{projectId}" },
      argument: { name: "projectId", value: "1" },
    });
    const result = response?.result as { completion: { values: string[] } };

    expect(result.completion.values).toEqual(["1", "13"]);
  });

  describe("errors", () => {
    it("rejects a missing argument with -32602", async () => {
      const alepha = await start();

      const response = await complete(alepha, {
        ref: { type: "ref/prompt", name: "review" },
      });

      expect(response?.error?.code).toBe(-32602);
      expect(response?.error?.message).toContain("argument.name");
    });

    it("rejects an unrecognized ref with -32602", async () => {
      const alepha = await start();

      const response = await complete(alepha, {
        ref: { type: "ref/nonsense" },
        argument: { name: "language", value: "" },
      });

      expect(response?.error?.code).toBe(-32602);
    });

    it("rejects a ref naming an unknown prompt with -32602", async () => {
      const alepha = await start();

      const response = await complete(alepha, {
        ref: { type: "ref/prompt", name: "nope" },
        argument: { name: "language", value: "" },
      });

      expect(response?.error?.code).toBe(-32602);
    });
  });

  describe("capability", () => {
    it("is declared when a prompt provides a complete handler", async () => {
      const alepha = await start();

      expect(
        alepha.inject(McpServerProvider).getCapabilities().completions,
      ).toEqual({});
    });

    /**
     * Advertising autocompletion the server cannot perform is worse than
     * advertising nothing: every client offers a picker that comes back empty.
     */
    it("is absent when no primitive provides one", async () => {
      class Plain {
        greet = $prompt({
          args: z.object({ name: z.text() }),
          handler: async () => [],
        });
      }

      const alepha = Alepha.create().with(AlephaMcp).with(Plain);
      await alepha.start();

      expect(
        alepha.inject(McpServerProvider).getCapabilities().completions,
      ).toBeUndefined();
    });
  });
});
