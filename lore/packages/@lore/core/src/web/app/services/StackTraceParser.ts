/**
 * One frame of a stack: where the call was, as the runtime printed it.
 */
export interface StackFrame {
  /**
   * The function, method or `new X` the frame ran, when the line names one.
   */
  fn?: string;
  /**
   * The file or URL, without its line and column.
   */
  file?: string;
  line?: number;
  column?: number;
  /**
   * The frame as printed, for a line no pattern below understood.
   */
  raw: string;
  /**
   * A dependency (`node_modules`), a runtime internal (`node:`) or a
   * minified bundle: what a reader skips to find their own code.
   */
  external: boolean;
}

/**
 * One error of a chain: its header and the frames printed under it.
 */
export interface StackError {
  name: string;
  message: string;
  frames: StackFrame[];
}

/**
 * Reads a stack string into the chain of errors it prints (#Q4186): the
 * error itself, then each `Caused by:` section, every one with its name,
 * message and frames.
 *
 * It reads the shapes Lore receives: V8's (`    at fn (file:1:2)`, also
 * `    at file:1:2` and `    at async fn (...)`), Firefox's and Safari's
 * (`fn@file:1:2`), and the cause lines the sigil appends after the frames
 * (`Caused by: Name: message`, with or without frames of their own). A line
 * that fits none of them is kept as text: a stack is attacker-controlled
 * and parsing it must never lose what it says.
 *
 * A header line that continues (a multi-line message, such as a SQL query)
 * is joined to the message until the first frame.
 */
export class StackTraceParser {
  protected static readonly CAUSED_BY = /^\s*Caused by:\s?(.*)$/;
  protected static readonly V8_FRAME = /^\s*at\s+(.*)$/;
  protected static readonly GECKO_FRAME = /^([^@\s]*)@(.+)$/;
  protected static readonly LOCATION = /^(.*?):(\d+)(?::(\d+))?$/;
  protected static readonly HEADER =
    /^([A-Za-z_$][\w$.]*(?:Error|Exception)?):\s?([\s\S]*)$/;

  public parse(stack: string, fallback?: { name?: string; message?: string }) {
    const chain: StackError[] = [];
    let current: StackError | undefined;
    let inFrames = false;

    const open = (header: string) => {
      const { name, message } = this.header(header);
      current = { name, message, frames: [] };
      chain.push(current);
      inFrames = false;
    };

    for (const line of stack.replace(/\r\n?/g, "\n").split("\n")) {
      const caused = line.match(StackTraceParser.CAUSED_BY);
      if (caused) {
        open(caused[1] ?? "");
        continue;
      }
      const frame = this.frame(line);
      if (frame) {
        if (!current) {
          current = {
            name: fallback?.name ?? "Error",
            message: fallback?.message ?? "",
            frames: [],
          };
          chain.push(current);
        }
        current.frames.push(frame);
        inFrames = true;
        continue;
      }
      if (!line.trim()) continue;
      if (!current) {
        open(line);
      } else if (!inFrames) {
        current.message = current.message
          ? `${current.message}\n${line}`
          : line.trim();
      } else {
        current.frames.push({ raw: line.trim(), external: false });
      }
    }

    if (chain.length === 0) {
      chain.push({
        name: fallback?.name ?? "Error",
        message: fallback?.message ?? "",
        frames: [],
      });
    }
    return chain;
  }

  protected header(text: string): { name: string; message: string } {
    const match = text.trim().match(StackTraceParser.HEADER);
    if (match) return { name: match[1]!, message: match[2] ?? "" };
    return { name: "", message: text.trim() };
  }

  protected frame(line: string): StackFrame | undefined {
    const v8 = line.match(StackTraceParser.V8_FRAME);
    if (v8) {
      const body = v8[1]!.trim();
      // `fn (location)` or a bare location.
      const call = body.match(/^(.*?)\s+\((.*)\)$/);
      const where = call ? call[2]! : body;
      const fn = call ? call[1] : undefined;
      return this.located(line.trim(), fn, where);
    }
    const gecko = line.trim().match(StackTraceParser.GECKO_FRAME);
    if (gecko && StackTraceParser.LOCATION.test(gecko[2]!)) {
      return this.located(line.trim(), gecko[1] || undefined, gecko[2]!);
    }
    return undefined;
  }

  protected located(raw: string, fn: string | undefined, where: string) {
    const location = where.match(StackTraceParser.LOCATION);
    const file = location ? location[1] : where;
    return {
      raw,
      ...(fn ? { fn } : {}),
      ...(file ? { file } : {}),
      ...(location?.[2] ? { line: Number(location[2]) } : {}),
      ...(location?.[3] ? { column: Number(location[3]) } : {}),
      external: this.external(file ?? ""),
    } satisfies StackFrame;
  }

  /**
   * Somebody else's code: a dependency, a runtime internal, or a minified
   * bundle (a hashed chunk name, or `.min.js`).
   */
  public external(file: string): boolean {
    return (
      file.includes("/node_modules/") ||
      file.startsWith("node:") ||
      file.startsWith("internal/") ||
      file === "native" ||
      file === "<anonymous>" ||
      /\.min\.[cm]?js$/.test(file) ||
      // Vite's chunk hash: eight characters, at least one a digit.
      /[-.](?=[\w-]{0,7}\d)[\w-]{8}\.[cm]?js$/.test(file)
    );
  }
}
