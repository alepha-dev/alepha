import { Alepha, z } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { $command } from "../primitives/$command.ts";
import { CliProvider } from "../providers/CliProvider.ts";
import { ConsoleInputProvider } from "../providers/ConsoleInputProvider.ts";
import { ConsoleOutputProvider } from "../providers/ConsoleOutputProvider.ts";
import { MemoryInputProvider } from "../providers/MemoryInputProvider.ts";
import { MemoryOutputProvider } from "../providers/MemoryOutputProvider.ts";

class NoteCommands {
  public received: Record<string, any> = {};

  note = $command({
    name: "note",
    flags: z.object({
      title: z.text().optional(),
      body: z
        .text({ size: "rich", atFile: true, description: "The body" })
        .optional(),
      summary: z.text({ atFile: true }).optional(),
      scope: z.text({ description: "A package name" }).optional(),
      tag: z.array(z.text()).describe("A tag").optional(),
      files: z
        .array(z.text())
        .meta({ atFile: true, description: "Tags from a file" })
        .optional(),
      count: z.array(z.integer()).optional(),
      level: z.integer().optional(),
    }),
    handler: async ({ flags }) => {
      this.received = flags;
    },
  });
}

const setup = () => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ConsoleInputProvider, use: MemoryInputProvider })
    .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });

  const commands = alepha.inject(NoteCommands);
  const cli = alepha.inject(CliProvider);
  const fs = alepha.inject(MemoryFileSystemProvider);
  const stdin = alepha.inject(MemoryInputProvider);
  const output = alepha.inject(MemoryOutputProvider);

  const run = async (argv: string[]) => {
    await cli.run(commands.note, { argv, root: "/project" });
    return commands.received;
  };

  return { cli, commands, fs, stdin, output, run };
};

describe("CliProvider flag values", () => {
  describe("@file on a flag declaring atFile", () => {
    it("reads @path against the command's root", async ({ expect }) => {
      const { fs, run } = setup();
      await fs.writeFile("/project/notes/plan.md", "## Plan\n\nBody.\n");

      const flags = await run(["--body", "@notes/plan.md"]);

      expect(flags.body).toBe("## Plan\n\nBody.");
    });

    it("reads the --flag=@path spelling too", async ({ expect }) => {
      const { fs, run } = setup();
      await fs.writeFile("/project/plan.md", "Body");

      const flags = await run(["--body=@plan.md"]);

      expect(flags.body).toBe("Body");
    });

    it("lets an absolute path win over the root", async ({ expect }) => {
      const { fs, run } = setup();
      await fs.writeFile("/elsewhere/plan.md", "Elsewhere");

      const flags = await run(["--body", "@/elsewhere/plan.md"]);

      expect(flags.body).toBe("Elsewhere");
    });

    /**
     * The reason the read happens after binding and not in an argv pre-pass:
     * a Markdown list starts with `- `, and substituted into argv it would be
     * read as a flag token, so `--body` would be refused as missing a value.
     */
    it("delivers a file starting with '- ' to a string flag intact", async ({
      expect,
    }) => {
      const { fs, run } = setup();
      await fs.writeFile("/project/list.md", "- one\n- two");

      const flags = await run(["--body", "@list.md", "--title", "List"]);

      expect(flags.body).toBe("- one\n- two");
      expect(flags.title).toBe("List");
    });

    it("hands a file holding JSON to a string flag as that string", async ({
      expect,
    }) => {
      const { fs, run } = setup();
      await fs.writeFile("/project/data.json", '{"a":1}');

      const flags = await run(["--body", "@data.json"]);

      expect(flags.body).toBe('{"a":1}');
    });

    it("accepts an empty file, which was named explicitly", async ({
      expect,
    }) => {
      const { fs, run } = setup();
      await fs.writeFile("/project/empty.md", "");

      const flags = await run(["--body", "@empty.md"]);

      expect(flags.body).toBe("");
    });

    it("refuses a file that cannot be read, naming it", async ({ expect }) => {
      const { run } = setup();

      await expect(run(["--body", "@missing.md"])).rejects.toThrow(
        "Flag --body: cannot read 'missing.md' (/project/missing.md)",
      );
    });

    it("refuses a bare @ that names no file", async ({ expect }) => {
      const { run } = setup();

      await expect(run(["--body", "@"])).rejects.toThrow("'@' names no file");
    });

    it("escapes a literal leading @ with @@", async ({ expect }) => {
      const { fs, run } = setup();
      // A file the unescaped reading would find, so a read would show.
      await fs.writeFile("/project/handle", "from the file");

      const flags = await run(["--body", "@@handle"]);

      expect(flags.body).toBe("@handle");
    });
  });

  describe("@ on a flag without atFile", () => {
    it("is a literal, with no file read", async ({ expect }) => {
      const { run } = setup();

      const flags = await run(["--scope", "@alepha/ui*"]);

      expect(flags.scope).toBe("@alepha/ui*");
    });

    it("leaves @@ untouched too", async ({ expect }) => {
      const { run } = setup();

      const flags = await run(["--scope", "@@x"]);

      expect(flags.scope).toBe("@@x");
    });
  });

  describe("@- reads stdin", () => {
    it("takes the whole of stdin as the value", async ({ expect }) => {
      const { stdin, run } = setup();
      stdin.content = "- piped\n- body";

      const flags = await run(["--body", "@-"]);

      expect(flags.body).toBe("- piped\n- body");
      expect(stdin.reads).toBe(1);
    });

    it("refuses a terminal without reading it", async ({ expect }) => {
      const { stdin, run } = setup();
      stdin.tty = true;

      await expect(run(["--body", "@-"])).rejects.toThrow(
        "Flag --body reads stdin (@-), and stdin is a terminal",
      );
      expect(stdin.reads).toBe(0);
    });

    it("refuses an empty read", async ({ expect }) => {
      const { run } = setup();

      await expect(run(["--body", "@-"])).rejects.toThrow(
        "Flag --body read nothing from stdin (@-)",
      );
    });

    it("refuses a second @- before reading anything", async ({ expect }) => {
      const { stdin, run } = setup();
      stdin.content = "body";

      await expect(run(["--body", "@-", "--summary", "@-"])).rejects.toThrow(
        "Only one flag value can read stdin",
      );
      expect(stdin.reads).toBe(0);
    });

    it("refuses @- repeated on one array flag", async ({ expect }) => {
      const { stdin, run } = setup();
      stdin.content = "a";

      await expect(run(["--files", "@-", "--files", "@-"])).rejects.toThrow(
        "Only one flag value can read stdin",
      );
    });

    it("leaves a flag given as '\"\"' empty, the way the refusal says", async ({
      expect,
    }) => {
      const { run } = setup();

      expect((await run(["--summary", ""])).summary).toBe("");
      expect((await run(["--summary="])).summary).toBe("");
    });
  });

  describe("repeated flags", () => {
    it("accumulates an array flag element by element", async ({ expect }) => {
      const { run } = setup();

      const flags = await run(["--tag", "a", "--tag", "b"]);

      expect(flags.tag).toEqual(["a", "b"]);
    });

    it("casts each occurrence against the element schema", async ({
      expect,
    }) => {
      const { run } = setup();

      const flags = await run(["--count", "1", "--count=2"]);

      expect(flags.count).toEqual([1, 2]);
    });

    it("keeps a JSON array working, and spreads it", async ({ expect }) => {
      const { run } = setup();

      expect((await run(["--tag", '["a","b"]'])).tag).toEqual(["a", "b"]);
      expect((await run(["--tag", '["a","b"]', "--tag", "c"])).tag).toEqual([
        "a",
        "b",
        "c",
      ]);
    });

    it("refuses a malformed JSON array rather than taking it for a tag", async ({
      expect,
    }) => {
      const { run } = setup();

      await expect(run(["--tag", '["a"'])).rejects.toThrow(
        "Invalid JSON value for flag --tag",
      );
    });

    it("keeps a repeated scalar last-wins", async ({ expect }) => {
      const { run } = setup();

      const flags = await run(["--level", "1", "--level", "2"]);

      expect(flags.level).toBe(2);
    });

    it("puts file contents through the array rule once, in order", async ({
      expect,
    }) => {
      const { fs, run } = setup();
      await fs.writeFile("/project/list.json", '["b","c"]');
      await fs.writeFile("/project/one.json", '{"a":1}');

      expect(
        (await run(["--files", "a", "--files", "@list.json", "--files", "d"]))
          .files,
      ).toEqual(["a", "b", "c", "d"]);
      expect((await run(["--files", "@one.json"])).files).toEqual(['{"a":1}']);
    });
  });

  describe("help", () => {
    it("says which flags take @file and which repeat", async ({ expect }) => {
      const { cli, commands, output } = setup();

      cli.printHelp(commands.note);

      const line = (flag: string) =>
        output.lines.find((it) => it.trimStart().startsWith(flag)) ?? "";
      expect(line("--body")).toContain(
        "The body (takes @file, or @- for stdin; @@ for a literal @)",
      );
      expect(line("--tag")).toContain("A tag (repeatable)");
      expect(line("--files")).toContain("(repeatable) (takes @file");
      expect(line("--scope")).not.toContain("@file");
      expect(line("--scope")).not.toContain("repeatable");
    });
  });
});
