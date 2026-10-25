import { spawn } from "node:child_process";

import { $env, $inject, AlephaError } from "alepha";
import { ShellProvider } from "alepha/system";

import { editorEnvSchema } from "../schemas/editorEnvSchema.ts";

/**
 * Opens a file at a line in the developer's editor.
 *
 * The conventions of `launch-editor` (`LAUNCH_EDITOR`, then `EDITOR`), with
 * the line syntax of the common GUI editors. Written here rather than taken
 * from that package, which this repository does not carry. A terminal editor
 * (`vim`, `nano`...) is refused: started from a server, it has no terminal to
 * show in.
 */
export class EditorLauncher {
  protected readonly env = $env(editorEnvSchema);
  protected readonly shell = $inject(ShellProvider);

  protected readonly terminalEditors = new Set([
    "vi",
    "vim",
    "nvim",
    "nano",
    "emacs",
    "micro",
    "helix",
    "hx",
  ]);

  protected readonly jetbrains = new Set([
    "idea",
    "webstorm",
    "phpstorm",
    "pycharm",
    "goland",
    "rubymine",
    "clion",
    "rider",
  ]);

  /**
   * Open `file` at `line:column`. Returns the editor command used.
   *
   * @throws AlephaError when no usable editor is configured or found.
   */
  public async open(file: string, line: number, column = 1): Promise<string> {
    if (this.env.LAUNCH_EDITOR) {
      this.launch(this.env.LAUNCH_EDITOR, [file, String(line), String(column)]);
      return this.env.LAUNCH_EDITOR;
    }

    const editor =
      this.env.EDITOR ||
      ((await this.shell.isInstalled("code")) ? "code" : undefined);
    if (!editor) {
      throw new AlephaError(
        "No editor to open the file with: set EDITOR (code, cursor, zed, webstorm...) or LAUNCH_EDITOR",
      );
    }

    const [command, ...flags] = editor.split(/\s+/);
    const name = (command.split(/[\\/]/).pop() ?? command).toLowerCase();
    if (this.terminalEditors.has(name)) {
      throw new AlephaError(
        `EDITOR is "${name}", a terminal editor the devtools cannot show: set LAUNCH_EDITOR, or EDITOR to a windowed editor`,
      );
    }

    this.launch(command, [...flags, ...this.args(name, file, line, column)]);
    return command;
  }

  protected args(
    name: string,
    file: string,
    line: number,
    column: number,
  ): string[] {
    const at = `${file}:${line}:${column}`;
    if (/^(code|code-insiders|codium|cursor|windsurf)$/.test(name)) {
      return ["-g", at];
    }
    if (this.jetbrains.has(name)) {
      return ["--line", String(line), "--column", String(column), file];
    }
    if (/^(zed|subl|sublime_text)$/.test(name)) {
      return [at];
    }
    return [file];
  }

  /**
   * Start the editor detached: it outlives the request, and the devtools
   * never waits on it.
   */
  protected launch(command: string, args: string[]): void {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  }
}
