import { afterEach, describe, it } from "vitest";

import { TrustedTypes } from "../services/TrustedTypes.ts";

/**
 * The framework's Trusted Types policy: created once, under its name, and a
 * plain passthrough where the browser has no `trustedTypes`.
 */
describe("TrustedTypes", () => {
  const g = globalThis as { trustedTypes?: unknown; [key: symbol]: unknown };
  const key = Symbol.for("alepha.trustedTypes.policy");

  afterEach(() => {
    delete g.trustedTypes;
    delete g[key];
  });

  it("returns its input unchanged with no trustedTypes", ({ expect }) => {
    expect(TrustedTypes.html("<b>")).toBe("<b>");
    expect(TrustedTypes.script("x=1")).toBe("x=1");
    expect(TrustedTypes.scriptURL("/a.js")).toBe("/a.js");
  });

  it("creates the alepha policy once and wraps every value with it", ({
    expect,
  }) => {
    const created: string[] = [];
    g.trustedTypes = {
      createPolicy: (
        name: string,
        rules: Record<string, (s: string) => string>,
      ) => {
        created.push(name);
        return {
          createHTML: (s: string) => ({ html: rules.createHTML(s) }),
          createScript: (s: string) => ({ script: rules.createScript(s) }),
          createScriptURL: (s: string) => ({ url: rules.createScriptURL(s) }),
        };
      },
    };

    expect(TrustedTypes.html("<b>")).toEqual({ html: "<b>" });
    expect(TrustedTypes.script("x=1")).toEqual({ script: "x=1" });
    expect(TrustedTypes.scriptURL("/a.js")).toEqual({ url: "/a.js" });
    expect(created).toEqual(["alepha"]);
  });
});
