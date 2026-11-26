import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { ErrorCommand } from "../commands/ErrorCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

const ERROR = {
  id: 42,
  name: "TypeError",
  message: "cart is undefined",
  stack: "TypeError: cart is undefined\n    at checkout (app.js:12:3)",
  sourceUrl: "/api/checkout",
  origin: "server",
  fingerprint: "abcdef",
  count: 7,
  status: "resolved",
  resolvedAt: "2026-11-10T09:00:00.000Z",
  seenAgain: true,
  firstSeenAt: "2026-11-01T10:00:00.000Z",
  lastSeenAt: "2026-11-20T10:00:00.000Z",
  trustedAt: "2026-11-01T10:00:00.000Z",
};

/**
 * `lore error get`, `lore error comment add` and `lore error list`: each on
 * the action the page calls, and what a shell reads back.
 */
describe("lore error get, comment add and list", () => {
  const create = () => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "k",
        LORE_URL: "https://lore.test",
        LORE_PROJECT: "hello",
        HOME: "/nonexistent",
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const sent: Array<[string, unknown]> = [];
    const record =
      (name: string, answer: (request: any) => unknown) =>
      async (request: unknown) => {
        sent.push([name, request]);
        return answer(request);
      };
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      {
        projects: {
          getProjectBySlug: async () => ({ id: 7 }),
          getProjectById: async () => ({ id: 7 }),
        },
      },
    );
    const errors = alepha.inject(ErrorCommand);
    Object.assign(errors as unknown as Record<string, unknown>, {
      projectErrorApi: {
        listProjectErrors: record("listProjectErrors", () => ({
          items: [
            ERROR,
            { ...ERROR, id: 43, status: "open", seenAgain: false },
          ],
          openCount: 1,
          awaitingTrust: 0,
          sigils: [],
        })),
        getProjectError: record("getProjectError", () => ({
          error: ERROR,
          kind: "sigil",
          apps: [
            {
              sigilId: "s1",
              label: "api/production",
              count: 7,
              firstSeenAt: ERROR.firstSeenAt,
              lastSeenAt: ERROR.lastSeenAt,
            },
          ],
          quest: {
            id: 900,
            shortId: 12,
            title: "Fix the cart",
            status: "todo",
          },
          rules: [],
        })),
        getProjectErrorTrend: record("getProjectErrorTrend", () => ({
          empty: false,
          total: 7,
          series: [
            { at: "2026-11-19", value: 0 },
            { at: "2026-11-20", value: 7 },
          ],
          markers: [{ at: "2026-11-19T12:00:00.000Z", kind: "deploy" }],
        })),
      },
      threadApi: {
        listProjectErrorThread: record("listProjectErrorThread", () => ({
          jobs: [],
          entries: [
            {
              type: "event",
              id: 1,
              at: "2026-11-10T09:00:00.000Z",
              kind: "resolved",
              userId: "u1",
              userName: "Ada",
            },
            {
              type: "event",
              id: 2,
              at: "2026-11-11T09:00:00.000Z",
              kind: "run_resolved",
            },
            {
              type: "comment",
              id: 10,
              at: "2026-11-12T09:00:00.000Z",
              userId: "u1",
              userName: "Ada",
              body: "Likely the cart reducer.",
              source: { kind: "mcp", client: "claude" },
            },
          ],
        })),
        createProjectErrorComment: record(
          "createProjectErrorComment",
          (request) => ({
            type: "comment",
            id: 11,
            at: "2026-11-13T09:00:00.000Z",
            body: request.body.body,
          }),
        ),
      },
    });
    const run = async (command: any, argv: string) => {
      await alepha.inject(CliProvider).run(command, { argv });
    };
    return { run, printed, sent, errors };
  };

  it("reads one error whole by B42 or 42: the row, its quest, its days and its thread", async ({
    expect,
  }) => {
    const { run, printed, sent, errors } = create();
    await run(errors.get, "B42");

    const at = { params: { projectId: 7, errorId: 42 } };
    expect(sent).toEqual([
      ["getProjectError", at],
      ["getProjectErrorTrend", at],
      ["listProjectErrorThread", at],
    ]);
    const out = printed.join("\n");
    expect(out).toContain("B42  TypeError");
    expect(out).toContain("cart is undefined");
    expect(out).toContain(
      "resolved, seen again since 2026-11-10T09:00:00.000Z",
    );
    expect(out).toContain("trusted on arrival");
    expect(out).toContain("Q12  Fix the cart  (todo)");
    expect(out).toContain("api/production  x7");
    expect(out).toContain("Last 30 days (7)");
    expect(out).toContain("2026-11-20  7");
    expect(out).not.toContain("2026-11-19  0");
    expect(out).toContain("2026-11-19T12:00:00.000Z  deploy");
    // The thread: who did it, Lore's own, and the agent mark on a comment.
    expect(out).toContain("resolved  by Ada");
    expect(out).toContain("run_resolved  by Lore");
    expect(out).toContain("Ada  (agent: claude)");
    expect(out).toContain("Likely the cart reducer.");

    sent.length = 0;
    await run(errors.get, "42");
    expect(sent[0]).toEqual(["getProjectError", at]);
  });

  it("answers the same read as JSON, with the thread's entries", async ({
    expect,
  }) => {
    const { run, printed, errors } = create();
    await run(errors.get, "42 --output json");
    const json = JSON.parse(printed.join("\n")) as {
      error: { id: number };
      trend: { total: number };
      thread: unknown[];
    };
    expect(json.error.id).toBe(42);
    expect(json.trend.total).toBe(7);
    expect(json.thread).toHaveLength(3);
  });

  it("comments as the account's owner, and as an agent only with --as", async ({
    expect,
  }) => {
    const { run, printed, sent, errors } = create();
    // The harness splits its arguments on spaces: one word is a body too.
    await run(errors.commentAdd, "42 --body Staging-too");
    expect(sent).toEqual([
      [
        "createProjectErrorComment",
        {
          params: { projectId: 7, errorId: 42 },
          body: { body: "Staging-too" },
        },
      ],
    ]);
    expect(printed.join("\n")).toContain("Commented on B42");

    sent.length = 0;
    await run(errors.commentAdd, "42 --body Finding --as claude-code");
    expect(sent[0]?.[1]).toEqual({
      params: { projectId: 7, errorId: 42 },
      body: {
        body: "Finding",
        source: { kind: "cli", client: "claude-code" },
      },
    });
    await expect(run(errors.commentAdd, "42")).rejects.toThrow(/body/);
  });

  it("lists the inbox and says which resolved error was seen again", async ({
    expect,
  }) => {
    const { run, printed, sent, errors } = create();
    await run(errors.list, "--include-resolved");
    expect(sent).toEqual([
      [
        "listProjectErrors",
        { params: { projectId: 7 }, query: { includeResolved: true } },
      ],
    ]);
    const out = printed.join("\n");
    expect(out).toMatch(/B42 .*resolved, seen again/);
    expect(out).toMatch(/B43 .*open/);
    expect(out).not.toMatch(/B43 .*seen again/);
  });
});
