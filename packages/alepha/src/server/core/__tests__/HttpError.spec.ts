import { z } from "alepha";
import { describe, expectTypeOf, it } from "vitest";

import {
  BadRequestError,
  HttpError,
  isHttpError,
  NotFoundError,
} from "../index.shared.ts";

const QuotaExceeded = HttpError.extend({
  name: "TEST_HTTP_QUOTA_EXCEEDED",
  default: { status: 409 },
  schema: z.object({ limit: z.number() }),
});

describe("HttpError", () => {
  it("is a declared error whose data carries the status", ({ expect }) => {
    const error = new HttpError({ status: 502 }, { message: "Upstream" });
    expect(error.name).toBe("HTTP");
    expect(error.data).toEqual({ status: 502 });
    expect(error.status).toBe(502);
    expect(error.message).toBe("Upstream");
  });

  it("gives every built-in its name, status and default message", ({
    expect,
  }) => {
    const error = new NotFoundError();
    expect(error).toBeInstanceOf(HttpError);
    expect(error.name).toBe("NOT_FOUND");
    expect(error.status).toBe(404);
    expect(error.message).toBe("Resource not found");
    expect(new BadRequestError("Missing name").message).toBe("Missing name");
  });

  it("extends with a typed schema merged into { status }", ({ expect }) => {
    const error = new QuotaExceeded({ limit: 5 });
    expect(error.data).toEqual({ status: 409, limit: 5 });
    expect(HttpError.toJSON(error)).toEqual({
      name: "TEST_HTTP_QUOTA_EXCEEDED",
      message: "TEST_HTTP_QUOTA_EXCEEDED",
      data: { status: 409, limit: 5 },
    });
    expectTypeOf(error.data.limit).toEqualTypeOf<number>();
    expectTypeOf(error.status).toEqualTypeOf<number>();
  });

  it("rebuilds a descendant from JSON", ({ expect }) => {
    const error = HttpError.fromJSON(
      HttpError.toJSON(new NotFoundError("No such page")),
    );
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("No such page");
  });

  it("recognises anything with a numeric status as an HTTP error", ({
    expect,
  }) => {
    expect(isHttpError(new NotFoundError(), 404)).toBe(true);
    expect(isHttpError(new NotFoundError(), 400)).toBe(false);
    expect(isHttpError({ message: "x", status: 503 })).toBe(true);
    expect(isHttpError({ message: "x", data: { status: 429 } }, 429)).toBe(
      true,
    );
    expect(isHttpError(new Error("plain"))).toBe(false);
  });
});
