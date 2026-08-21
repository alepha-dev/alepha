import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { ServerReply } from "../helpers/ServerReply.ts";
import type { ServerRoute } from "../interfaces/ServerRequest.ts";
import { ServerRouterProvider } from "../providers/ServerRouterProvider.ts";

describe("ServerRouterProvider - serializeResponse", () => {
  const alepha = Alepha.create();
  const router = alepha.inject(ServerRouterProvider);
  const route = { schema: {} } as ServerRoute;

  it("should sanitize double quotes in filename", ({ expect }) => {
    const reply = new ServerReply();
    reply.body = new File(["data"], 'file"name.txt', {
      type: "text/plain",
    });

    router.serializeResponse(route, reply, "file");

    expect(reply.headers["content-disposition"]).toBe(
      'attachment; filename="file\\"name.txt"',
    );
  });

  it("should sanitize backslashes in filename", ({ expect }) => {
    const reply = new ServerReply();
    reply.body = new File(["data"], "path\\file.txt", {
      type: "text/plain",
    });

    router.serializeResponse(route, reply, "file");

    expect(reply.headers["content-disposition"]).toBe(
      'attachment; filename="path\\\\file.txt"',
    );
  });

  it("should strip newlines from filename to prevent header injection", ({
    expect,
  }) => {
    const reply = new ServerReply();
    reply.body = new File(["data"], "file\r\nX-Injected: true", {
      type: "text/plain",
    });

    router.serializeResponse(route, reply, "file");

    expect(reply.headers["content-disposition"]).toBe(
      'attachment; filename="fileX-Injected: true"',
    );
    expect(reply.headers["content-disposition"]).not.toContain("\r");
    expect(reply.headers["content-disposition"]).not.toContain("\n");
  });

  it("should handle normal filenames", ({ expect }) => {
    const reply = new ServerReply();
    reply.body = new File(["data"], "report.pdf", {
      type: "application/pdf",
    });

    router.serializeResponse(route, reply, "file");

    expect(reply.headers["content-disposition"]).toBe(
      'attachment; filename="report.pdf"',
    );
    expect(reply.headers["content-type"]).toBe("application/pdf");
  });
});
