import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha } from "alepha";
import { FileSystemProvider, NodeFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { StackCommand } from "../commands/StackCommand.ts";

class TestStackCommand extends StackCommand {
  public read(root: string, file: string) {
    return this.readDotenv(root, file);
  }
}

describe("lore stack secrets set --file", () => {
  it("reads a dotenv file by a relative path and by an absolute one", async ({
    expect,
  }) => {
    const dir = mkdtempSync(join(tmpdir(), "lore-dotenv-"));
    writeFileSync(join(dir, "stack.env"), 'KEY="value"\n');
    const command = Alepha.create()
      .with({ provide: FileSystemProvider, use: NodeFileSystemProvider })
      .inject(TestStackCommand);

    expect(await command.read(dir, "stack.env")).toEqual([
      { key: "KEY", value: "value" },
    ]);
    expect(await command.read("/", join(dir, "stack.env"))).toEqual([
      { key: "KEY", value: "value" },
    ]);
  });
});
