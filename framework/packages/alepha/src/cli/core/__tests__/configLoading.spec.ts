import { describe, it } from "vitest";

import { AlephaCliExtensionProvider } from "../providers/AlephaCliExtensionProvider.ts";

class TestExtension extends AlephaCliExtensionProvider {
  public loads(argv: string[]): boolean {
    return this.loadsConfig(argv);
  }
}

describe("which invocations load alepha.config.ts", () => {
  const loads = (argv: string[]) =>
    Object.create(TestExtension.prototype).loads(argv) as boolean;

  it("skips the config for the root init only", ({ expect }) => {
    expect(loads(["init"])).toBe(false);
    expect(loads(["init", "my-app"])).toBe(false);
  });

  it("loads it for a plugin's subcommand named init", ({ expect }) => {
    expect(loads(["capacitor", "init"])).toBe(true);
    expect(loads(["capacitor", "init", "--ota"])).toBe(true);
  });

  it("loads it for a plugin command's help", ({ expect }) => {
    expect(loads(["capacitor", "--help"])).toBe(true);
  });

  it("skips it for the bare help screens and infra help", ({ expect }) => {
    expect(loads([])).toBe(false);
    expect(loads(["--help"])).toBe(false);
    expect(loads(["help"])).toBe(false);
    expect(loads(["infra"])).toBe(false);
    expect(loads(["deploy", "--help"])).toBe(false);
  });

  it("loads it for an ordinary command", ({ expect }) => {
    expect(loads(["build"])).toBe(true);
    expect(loads(["dev"])).toBe(true);
  });
});
