import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

import { TraceparentCodec } from "../services/TraceparentCodec.ts";

const codec = () => Alepha.create().inject(TraceparentCodec);

describe("TraceparentCodec", () => {
  it("parses a valid header with its sampled flag", () => {
    expect(
      codec().parse("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"),
    ).toEqual({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      sampled: true,
    });
    expect(
      codec().parse("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00")
        ?.sampled,
    ).toBe(false);
  });

  it("reads a future version as 00, ignoring extra fields", () => {
    expect(
      codec().parse(
        "01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01-extra",
      )?.traceId,
    ).toBe("0af7651916cd43dd8448eb211c80319c");
  });

  it("refuses invalid headers", () => {
    const c = codec();
    for (const header of [
      undefined,
      "",
      "garbage",
      "ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
      "00-00000000000000000000000000000000-b7ad6b7169203331-01",
      "00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01",
      "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01-extra",
      "00-0af7651916cd43dd8448eb211c8031-b7ad6b7169203331-01",
      "00-0af7651916cd43dd8448eb211c80319z-b7ad6b7169203331-01",
    ]) {
      expect(c.parse(header)).toBeUndefined();
    }
  });

  it("formats a context, round-tripping through parse", () => {
    const c = codec();
    const context = {
      traceId: c.newTraceId(),
      spanId: c.newSpanId(),
      sampled: true,
    };
    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(c.parse(c.format(context))).toEqual(context);
    expect(c.format({ ...context, sampled: false })).toMatch(/-00$/);
  });
});
