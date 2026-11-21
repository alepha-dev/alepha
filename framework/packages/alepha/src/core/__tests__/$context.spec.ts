import { $context, Alepha } from "alepha";
import { describe, it } from "vitest";

import { MissingContextError } from "../errors/MissingContextError.ts";

describe("$context", () => {
  it("should throw MissingContextError outside injection", ({ expect }) => {
    expect(() => $context()).toThrow(MissingContextError);
  });

  it("should return alepha instance during injection", ({ expect }) => {
    let capturedAlepha: unknown;

    class App {
      _ctx = (() => {
        const ctx = $context();
        capturedAlepha = ctx.alepha;
      })();
    }

    const alepha = Alepha.create();
    alepha.inject(App);

    expect(capturedAlepha).toBe(alepha);
  });

  it("should return service definition during injection", ({ expect }) => {
    let capturedService: unknown;

    class App {
      _ctx = (() => {
        const ctx = $context();
        capturedService = ctx.service;
      })();
    }

    Alepha.create().inject(App);

    expect(capturedService).toBe(App);
  });

  it("should return undefined module when no module is used", ({ expect }) => {
    let capturedModule: unknown = "NOT_SET";

    class App {
      _ctx = (() => {
        const ctx = $context();
        capturedModule = ctx.module;
      })();
    }

    Alepha.create().inject(App);

    expect(capturedModule).toBeUndefined();
  });
});
