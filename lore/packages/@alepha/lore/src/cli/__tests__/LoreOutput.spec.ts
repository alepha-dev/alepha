import { $inject, Alepha, z } from "alepha";
import {
  $command,
  AlephaCommand,
  CommandError,
  ConsoleOutputProvider,
  cliOptions,
  MemoryOutputProvider,
} from "alepha/command";
import {
  $logger,
  ConsoleDestinationProvider,
  LogDestinationProvider,
} from "alepha/logger";
import { describe, it } from "vitest";

import { LoreOutput } from "../services/LoreOutput.ts";

const setup = () => {
  const alepha = Alepha.create({ env: { NO_COLOR: "true" } }).with({
    provide: ConsoleOutputProvider,
    use: MemoryOutputProvider,
  });
  const out = alepha.inject(MemoryOutputProvider);
  const render = alepha.inject(LoreOutput);
  const print = (line = "") => out.print(line);
  return { out, render, print };
};

/**
 * The console destination with both streams recorded, the way a real `lore`
 * process writes them.
 */
class RecordingConsoleDestination extends ConsoleDestinationProvider {
  public readonly stdout: string[] = [];
  public readonly stderr: string[] = [];

  protected override writeStdout(message: string): void {
    this.stdout.push(message);
  }

  protected override writeStderr(message: string): void {
    this.stderr.push(message);
  }
}

describe("LoreOutput", () => {
  describe("a list", () => {
    it("puts the handle first, aligned, then the title, then at most two fields", ({
      expect,
    }) => {
      const { out, render, print } = setup();

      render.list(print, [
        {
          handle: "Q7",
          title: "Fix it",
          fields: ["todo", "alepha/orm", "dropped"],
        },
        { handle: "Q1204", title: "Ship it", fields: [undefined, "lore"] },
      ]);

      expect(out.lines).toEqual([
        "Q7     Fix it  todo  alepha/orm",
        "Q1204  Ship it  lore",
      ]);
    });

    it("says so when the page is not the whole result", ({ expect }) => {
      const { out, render, print } = setup();
      const rows = [{ handle: "Q1", title: "One" }];

      render.list(print, rows, { offset: 0, limit: 1, total: 134 });
      render.list(print, rows, { offset: 10, limit: 1, total: 134 });
      render.list(print, rows, { offset: 0, limit: 20, total: 1 });

      expect(out.lines).toEqual([
        "Q1  One",
        "1 of 134. Next page: --offset 1",
        "Q1  One",
        "11-11 of 134. Next page: --offset 11",
        "Q1  One",
      ]);
    });

    it("says there may be more when a full page came back and no total did", ({
      expect,
    }) => {
      const { out, render, print } = setup();

      render.list(print, [{ handle: "F1", title: "One" }], {
        offset: 0,
        limit: 1,
      });

      expect(out.lines.at(-1)).toBe(
        "1 shown, there may be more. Next page: --offset 1",
      );
    });
  });

  describe("an entity", () => {
    it("prints its fields, a blank line, its body verbatim, then its sections", ({
      expect,
    }) => {
      const { out, render, print } = setup();

      render.entity(print, {
        fields: [
          ["Quest", "Q12"],
          ["Status", "in_progress"],
          ["Due", undefined],
        ],
        body: "## Why\n\n- because",
        sections: [
          {
            title: "Objectives",
            lines: [
              render.objective({ id: 0, title: "Spec", completed: true }),
              render.objective({ id: 1, title: "Docs", completed: false }),
              render.objective({
                id: 2,
                title: "Walk it",
                completed: false,
                waivedReason: "manual",
              }),
            ],
          },
        ],
      });

      expect(out.lines).toEqual([
        "Quest:   Q12",
        "Status:  in_progress",
        "",
        "## Why\n\n- because",
        "",
        "Objectives:",
        "[x] 0  Spec",
        "[ ] 1  Docs",
        "[-] 2  Walk it (waived: manual)",
      ]);
    });

    it("says a protected body is protected and never prints the ciphertext", ({
      expect,
    }) => {
      const { out, render, print } = setup();

      render.entity(print, {
        fields: [["Folio", "F3"]],
        body: '{"v":1,"iv":"q0ZX","ct":"8b1f2e"}',
        protected: true,
      });

      expect(out.text).toContain("This folio is protected");
      expect(out.text).not.toContain("8b1f2e");
    });
  });

  /**
   * Through a real command in a CLI container: nothing picks the format but
   * the flag, and stdout is not a terminal here.
   */
  describe("the --output flag", () => {
    class NoteCommands {
      protected readonly render = $inject(LoreOutput);
      protected readonly log = $logger();

      note = $command({
        name: "note",
        flags: z.object({
          ...LoreOutput.FLAGS,
          fail: z.boolean().describe("Fail after the write").optional(),
        }),
        handler: async ({ flags, print }) => {
          const created = { id: 41, shortId: 7, title: "Note" };
          this.log.info("Creating the note");
          if (flags.output === "json") {
            this.render.json(print, created);
          } else {
            this.render.write(print, "Created Q7 Note");
          }
          if (flags.fail) {
            throw new CommandError(
              "Created Q7, but did not accept it: the epic is a draft.",
            );
          }
        },
      });
    }

    const run = async (argv: string[]) => {
      const alepha = Alepha.create({
        env: {
          LOG_LEVEL: "alepha.core:warn,info",
          LOG_FORMAT: "raw",
          NO_COLOR: "true",
        },
      })
        .with({
          provide: LogDestinationProvider,
          use: RecordingConsoleDestination,
        })
        .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
        .with(AlephaCommand)
        .with(NoteCommands);
      alepha.store.mut(cliOptions, (old) => ({ ...old, argv }));
      await alepha.start();
      const exitCode = process.exitCode;
      process.exitCode = 0;
      return {
        stdout: alepha.inject(MemoryOutputProvider).text,
        logs: alepha.inject(RecordingConsoleDestination),
        exitCode,
      };
    };

    it("renders for a human when no format is asked for", async ({
      expect,
    }) => {
      const { stdout } = await run(["note"]);

      expect(stdout).toBe("Created Q7 Note");
    });

    it("puts exactly one JSON document on stdout when json is asked for", async ({
      expect,
    }) => {
      const { stdout, logs } = await run(["note", "--output", "json"]);

      expect(JSON.parse(stdout)).toEqual({ id: 41, shortId: 7, title: "Note" });
      expect(logs.stdout).toEqual([]);
    });

    it("keeps stdout one JSON document on a partial write, its refusal on stderr", async ({
      expect,
    }) => {
      const { stdout, logs, exitCode } = await run([
        "note",
        "--output",
        "json",
        "--fail",
      ]);

      expect(JSON.parse(stdout)).toEqual({ id: 41, shortId: 7, title: "Note" });
      expect(logs.stdout).toEqual([]);
      expect(logs.stderr.join("\n")).toContain("did not accept it");
      expect(exitCode).toBe(1);
    });

    it("refuses a format it does not know", async ({ expect }) => {
      const { stdout, logs, exitCode } = await run([
        "note",
        "--output",
        "yaml",
      ]);

      expect(logs.stderr.join("\n")).toContain("Invalid flag");
      expect(stdout).toContain("Usage:");
      expect(exitCode).toBe(1);
    });
  });
});
