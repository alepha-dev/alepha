import { z } from "alepha";
import { describe, expectTypeOf, it } from "vitest";

import {
  $error,
  HttpError,
  NotFoundError,
  ValidationError,
} from "../index.shared.ts";

const QuotaExceeded = $error({
  code: "QuotaExceeded",
  status: 409,
  data: z.object({ limit: z.number(), used: z.number() }),
});

const UserNotFound = $error({ code: "UserNotFound", status: 404 });

const Teapot = $error({
  code: "Teapot",
  status: 418,
  message: "I am a teapot",
});

describe("$error", () => {
  describe("class", () => {
    it("returns an HttpError subclass with static code, status and schema", ({
      expect,
    }) => {
      expect(QuotaExceeded.code).toBe("QuotaExceeded");
      expect(QuotaExceeded.status).toBe(409);
      expect(QuotaExceeded.schema).toBeDefined();
      expect(UserNotFound.schema).toBeUndefined();
      expect(QuotaExceeded.name).toBe("QuotaExceeded");

      const error = new QuotaExceeded({ limit: 5, used: 6 });
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toBeInstanceOf(QuotaExceeded);
      expect(error).not.toBeInstanceOf(UserNotFound);
      expect(error.status).toBe(409);
      expect(error.error).toBe("QuotaExceeded");
      expect(error.name).toBe("QuotaExceeded");
      expect(error.data).toEqual({ limit: 5, used: 6 });
    });

    it("defaults the message to the declared one, else the status text", ({
      expect,
    }) => {
      expect(new UserNotFound().message).toBe("Not Found");
      expect(new Teapot().message).toBe("I am a teapot");
      expect(new UserNotFound({ message: "No user 42" }).message).toBe(
        "No user 42",
      );
    });

    it("keeps the cause", ({ expect }) => {
      const cause = new Error("db said no");
      const error = new QuotaExceeded(
        { limit: 1, used: 2 },
        { message: "Too many", cause },
      );
      expect(error.message).toBe("Too many");
      expect(error.cause).toBe(cause);
      expect(error.reason).toEqual({ name: "Error", message: "db said no" });
    });
  });

  describe("typing", () => {
    it("types the constructor from the schema", () => {
      expectTypeOf(QuotaExceeded).constructorParameters.toEqualTypeOf<
        [
          data: { limit: number; used: number },
          init?: { message?: string; cause?: unknown },
        ]
      >();
      expectTypeOf(UserNotFound).constructorParameters.toEqualTypeOf<
        [init?: { message?: string; cause?: unknown }]
      >();

      // @ts-expect-error data is required
      void (() => new QuotaExceeded());
      // @ts-expect-error data is typed
      void (() => new QuotaExceeded({ limit: "5", used: 6 }));
    });

    it("narrows with instanceof and types data", () => {
      const error: unknown = new QuotaExceeded({ limit: 5, used: 6 });
      if (error instanceof QuotaExceeded) {
        expectTypeOf(error.data).toEqualTypeOf<{
          limit: number;
          used: number;
        }>();
        expectTypeOf(error.error).toEqualTypeOf<"QuotaExceeded">();
      }
      type QuotaExceededType = InstanceType<typeof QuotaExceeded>;
      expectTypeOf<QuotaExceededType["status"]>().toEqualTypeOf<number>();
    });
  });

  describe("serialization", () => {
    it("writes the code into error and the payload into data", ({ expect }) => {
      const json = HttpError.toJSON(new QuotaExceeded({ limit: 5, used: 6 }));
      expect(json).toEqual({
        error: "QuotaExceeded",
        status: 409,
        message: "Conflict",
        data: { limit: 5, used: 6 },
      });
    });

    it("leaves the built-in wire shape unchanged", ({ expect }) => {
      expect(HttpError.toJSON(new NotFoundError())).toEqual({
        error: "NotFoundError",
        status: 404,
        message: "Resource not found",
      });
      expect(HttpError.toJSON(new HttpError({ status: 503 })).error).toBe(
        "ServiceUnavailableError",
      );
    });
  });

  describe("registry", () => {
    it("holds the $error constants and the built-in classes by code", ({
      expect,
    }) => {
      expect(HttpError.registry.get("QuotaExceeded")).toBe(QuotaExceeded);
      expect(HttpError.registry.get("NotFoundError")).toBe(NotFoundError);
      expect(HttpError.registry.get("ValidationError")).toBe(ValidationError);
    });

    it("lets the last registration of a code win", ({ expect }) => {
      const First = $error({ code: "ReEvaluated", status: 400 });
      const Second = $error({ code: "ReEvaluated", status: 400 });
      expect(First).not.toBe(Second);
      expect(HttpError.registry.get("ReEvaluated")).toBe(Second);
    });
  });

  describe("fromJSON", () => {
    it("rebuilds the registered class without calling its constructor", ({
      expect,
    }) => {
      const json = HttpError.toJSON(
        new QuotaExceeded({ limit: 5, used: 6 }, { message: "Over quota" }),
      );
      const error = HttpError.fromJSON(json);
      expect(error).toBeInstanceOf(QuotaExceeded);
      expect(error).toBeInstanceOf(HttpError);
      expect(error.message).toBe("Over quota");
      expect(error.status).toBe(409);
      expect(error.error).toBe("QuotaExceeded");
      expect(error.name).toBe("QuotaExceeded");
      expect(error.data).toEqual({ limit: 5, used: 6 });
    });

    it("rebuilds a built-in class", ({ expect }) => {
      const error = HttpError.fromJSON(
        HttpError.toJSON(new NotFoundError("No such page")),
      );
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.message).toBe("No such page");
      expect(error.status).toBe(404);
    });

    it("falls back to HttpError for an unknown code", ({ expect }) => {
      const error = HttpError.fromJSON({
        error: "SomethingElse",
        status: 418,
        message: "nope",
      });
      expect(error.constructor).toBe(HttpError);
      expect(error.error).toBe("SomethingElse");
      expect(error.status).toBe(418);
    });

    it("falls back to HttpError when data fails the schema", ({ expect }) => {
      const error = HttpError.fromJSON({
        error: "QuotaExceeded",
        status: 409,
        message: "Conflict",
        data: { limit: "five" },
      });
      expect(error).not.toBeInstanceOf(QuotaExceeded);
      expect(error.constructor).toBe(HttpError);
      expect(error.data).toEqual({ limit: "five" });
    });
  });
});
