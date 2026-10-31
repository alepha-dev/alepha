import { Alepha, type FileLike } from "alepha";
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
