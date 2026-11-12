import { Alepha, type FileLike } from "alepha";
import { HttpClient, HttpError, NotFoundError } from "alepha/server";
import { describe, it } from "vitest";

import { BatchCollector } from "../services/BatchCollector.ts";

describe("BatchCollector", () => {
  it("sends a body holding a FileLike through its direct call, not as JSON", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const collector = alepha.inject(BatchCollector);
    // A FileLike that is no Blob: what `file()` and the server's multipart
    // parser hand out, and what HttpClient sends as multipart.
    const attachment: FileLike = {
      name: "report.pdf",
      type: "application/pdf",
      size: 3,
      lastModified: 0,
      stream: () => new ReadableStream(),
      text: async () => "pdf",
      arrayBuffer: async () => new ArrayBuffer(3),
    };
    const direct: string[] = [];
    const entry = (action: string, body?: Record<string, any>) => ({
      action,
      body,
      directCall: async () => {
        direct.push(action);
        return action;
      },
    });

    const results = await Promise.all([
      collector.add(entry("upload", { file: attachment })),
      collector.add(entry("list")),
    ]);

    expect(results).toEqual(["upload", "list"]);
    expect(direct).toEqual(["upload", "list"]);
  });

  it("reports a failed entry on client:request:error, once per distinct call, as a single call does", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const http = alepha.inject(HttpClient);
    http.fetch = (async () => ({
      data: [
        { action: "ok", status: 200, data: "fine" },
        {
          action: "secret",
          status: 401,
          error: "Sign in first",
          name: "UNAUTHORIZED",
        },
      ],
    })) as any;
    const heard: number[] = [];
    alepha.events.on("client:request:error", ({ error }) => {
      heard.push((error as HttpError).status);
    });
    const collector = alepha.inject(BatchCollector);
    const entry = (action: string) => ({
      action,
      directCall: async () => action,
    });

    const settled = await Promise.allSettled([
      collector.add(entry("ok")),
      collector.add(entry("secret")),
      // The same call again: deduplicated, one report for both.
      collector.add(entry("secret")),
    ]);

    expect(settled.map((it) => it.status)).toEqual([
      "fulfilled",
      "rejected",
      "rejected",
    ]);
    expect(heard).toEqual([401]);
  });

  it("rejects a failed entry as its own class, with its request id (#Q3104)", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const http = alepha.inject(HttpClient);
    http.fetch = (async () => ({
      data: [
        { action: "ok", status: 200, data: "fine" },
        {
          action: "missing",
          status: 404,
          error: "No such file",
          name: "NOT_FOUND",
          requestId: "req-batch-q3104",
        },
        { action: "old", status: 503, error: "Internal Server Error" },
      ],
    })) as any;
    const collector = alepha.inject(BatchCollector);
    const entry = (action: string) => ({
      action,
      directCall: async () => action,
    });

    const [ok, missing, old] = await Promise.allSettled([
      collector.add(entry("ok")),
      collector.add(entry("missing")),
      collector.add(entry("old")),
    ]);

    expect(ok).toStrictEqual({ status: "fulfilled", value: "fine" });
    const error = (missing as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.message).toBe("No such file");
    expect(error.status).toBe(404);
    expect(error.data.requestId).toBe("req-batch-q3104");
    // A server that predates the fields still rejects as an HttpError.
    const legacy = (old as PromiseRejectedResult).reason;
    expect(legacy).toBeInstanceOf(HttpError);
    expect(legacy.status).toBe(503);
    expect(legacy.data.requestId).toBeUndefined();
  });

  it("should deduplicate identical entries", ({ expect }) => {
    const alepha = Alepha.create();
    const collector = alepha.inject(BatchCollector);

    const batch = [
      mockEntry("getUser", { id: "1" }),
      mockEntry("getUser", { id: "1" }),
      mockEntry("getUser", { id: "2" }),
    ];

    // Access the protected dedupe method via a test subclass approach
    const result = (collector as any).dedupe(batch);

    // Two unique entries (id:1 and id:2), three total
    expect(result.unique).toHaveLength(2);
    expect(result.indexMap).toEqual([0, 0, 1]);
  });

  it("should chunk arrays correctly", ({ expect }) => {
    const alepha = Alepha.create();
    const collector = alepha.inject(BatchCollector);

    const items = [1, 2, 3, 4, 5];
    const chunks = (collector as any).chunk(items, 2);

    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("should not deduplicate entries with different params", ({ expect }) => {
    const alepha = Alepha.create();
    const collector = alepha.inject(BatchCollector);

    const batch = [
      mockEntry("getUser", { id: "1" }),
      mockEntry("getUser", { id: "2" }),
      mockEntry("getUser", { id: "3" }),
    ];

    const result = (collector as any).dedupe(batch);

    expect(result.unique).toHaveLength(3);
    expect(result.indexMap).toEqual([0, 1, 2]);
  });

  it("should not deduplicate entries with different actions", ({ expect }) => {
    const alepha = Alepha.create();
    const collector = alepha.inject(BatchCollector);

    const batch = [
      mockEntry("getUser", { id: "1" }),
      mockEntry("getOrder", { id: "1" }),
    ];

    const result = (collector as any).dedupe(batch);

    expect(result.unique).toHaveLength(2);
    expect(result.indexMap).toEqual([0, 1]);
  });
});

function mockEntry(action: string, params?: Record<string, any>) {
  return {
    entry: {
      action,
      params,
      directCall: () => Promise.resolve(),
    },
    resolve: () => {},
    reject: () => {},
  };
}
