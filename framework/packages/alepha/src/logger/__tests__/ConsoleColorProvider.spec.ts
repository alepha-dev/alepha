import { Alepha } from "alepha";
import { afterEach, describe, it } from "vitest";

import { ConsoleColorProvider } from "../index.ts";

describe("ConsoleColorProvider", () => {
  const original = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

  const setTTY = (value: boolean | undefined) => {
    Object.defineProperty(process.stdout, "isTTY", {
      value,
      configurable: true,
      writable: true,
    });
  };

  const colorsFor = (env: Record<string, string>) =>
    Alepha.create({ env: { NODE_ENV: "development", ...env } })
      .inject(ConsoleColorProvider)
      .isEnabled();

  afterEach(() => {
    if (original) {
      Object.defineProperty(process.stdout, "isTTY", original);
    } else {
      delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });

  it("colours a terminal", ({ expect }) => {
    setTTY(true);
    expect(colorsFor({})).toBe(true);
  });

  it("writes plain text to a file or a pipe", ({ expect }) => {
    setTTY(undefined);
    expect(colorsFor({})).toBe(false);
  });

  it("colours a pipe when FORCE_COLOR asks", ({ expect }) => {
    setTTY(undefined);
    expect(colorsFor({ FORCE_COLOR: "1" })).toBe(true);
  });

  it("NO_COLOR wins over a terminal", ({ expect }) => {
    setTTY(true);
    expect(colorsFor({ NO_COLOR: "1" })).toBe(false);
  });

  it("never colours production, even on a terminal", ({ expect }) => {
    setTTY(true);
    expect(colorsFor({ NODE_ENV: "production" })).toBe(false);
  });
});
