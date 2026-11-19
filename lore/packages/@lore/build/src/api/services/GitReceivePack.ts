import { AlephaError } from "alepha";

/**
 * What Lore reads of a `git-receive-pack` request before it reaches the
 * backend (#Q3932): the ref commands, the capabilities and the push options,
 * all in the pkt-lines that precede the pack, so a push that deletes the
 * default branch is refused and an import is told apart from a push.
 *
 * It buffers only that head (a few hundred bytes, capped at
 * {@link GitReceivePack.HEAD_LIMIT}) and hands back a stream that replays it
 * before the rest, so the pack itself is never held.
 */
export class GitReceivePack {
  /**
   * The most a request may carry before its pack. A push of thousands of
   * refs at once stays well under it.
   */
  public static readonly HEAD_LIMIT = 4 * 1024 * 1024;

  /**
   * The zero id: a command whose `new` is this deletes the ref.
   */
  public static readonly ZERO = "0".repeat(40);

  /**
   * Read the ref commands, the capabilities and the push options, and the
   * body to forward.
   */
  public async inspect(body: ReadableStream<Uint8Array>): Promise<{
    commands: GitRefCommand[];
    capabilities: string[];
    pushOptions: string[];
    body: ReadableStream<Uint8Array>;
  }> {
    const reader = body.getReader();
    let buffer: Uint8Array = new Uint8Array(0);
    let parsed: ReturnType<GitReceivePack["parseHead"]>;
    for (;;) {
      parsed = this.parseHead(buffer);
      if (parsed.complete) break;
      if (buffer.length > GitReceivePack.HEAD_LIMIT) {
        await reader.cancel();
        throw new AlephaError("The push's ref commands are too long");
      }
      const { done, value } = await reader.read();
      if (done) {
        parsed = this.parseHead(buffer, true);
        break;
      }
      buffer = this.concat(buffer, value);
    }
    if (!parsed.capabilities.includes("push-options")) {
      return {
        commands: parsed.commands,
        capabilities: parsed.capabilities,
        pushOptions: parsed.pushOptions,
        body: this.replay(buffer, reader),
      };
    }
    // Lore advertised `push-options` itself (see `advertisePushOptions`), so
    // the backend never did: it gets the commands without the capability and
    // without the options section, which Lore keeps.
    const capabilities = parsed.capabilities.filter(
      (it) => it !== "push-options",
    );
    const head = this.concat(
      ...parsed.commands.map((command, index) =>
        this.pkt(
          `${command.oldId} ${command.newId} ${command.ref}${index === 0 ? `\0${capabilities.join(" ")}` : ""}\n`,
        ),
      ),
      this.flush(),
      buffer.slice(parsed.headEnd),
    );
    return {
      commands: parsed.commands,
      capabilities,
      pushOptions: parsed.pushOptions,
      body: this.replay(head, reader),
    };
  }

  /**
   * A receive-pack advertisement with `push-options` among its capabilities.
   *
   * Lore reads push options itself (`lore code import` marks its pushes
   * `lore-import`), whatever the backend says: Artifacts may not advertise
   * them, and a git client refuses to send an option the server did not
   * offer. `inspect` takes them out again before the backend sees the push.
   */
  public advertisePushOptions(
    advertisement: ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    const reader = advertisement.getReader();
    const decoder = new TextDecoder();
    let buffer: Uint8Array = new Uint8Array(0);
    let done = false;
    let rewritten = false;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (rewritten) {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
          return;
        }
        // Read until the first ref line is whole: after the `# service=`
        // line and its flush, when they are there.
        for (;;) {
          const at = this.firstRefLine(buffer);
          if (at || done) {
            rewritten = true;
            if (!at) {
              if (buffer.length) controller.enqueue(buffer);
              controller.close();
              return;
            }
            const line = decoder.decode(buffer.slice(at.start + 4, at.end));
            const nul = line.indexOf("\0");
            let updated = line;
            if (nul !== -1) {
              const caps = line
                .slice(nul + 1)
                .replace(/\n$/, "")
                .split(" ");
              if (!caps.includes("push-options")) {
                updated = `${line.slice(0, nul + 1)}${[...caps.filter(Boolean), "push-options"].join(" ")}\n`;
              }
            }
            controller.enqueue(
              this.concat(
                buffer.slice(0, at.start),
                this.pkt(updated),
                buffer.slice(at.end),
              ),
            );
            return;
          }
          const next = await reader.read();
          if (next.done) done = true;
          else buffer = this.concat(buffer, next.value);
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
  }

  /**
   * Where the first ref line of an advertisement sits in the buffer, once
   * it is whole.
   */
  protected firstRefLine(
    buffer: Uint8Array,
  ): { start: number; end: number } | undefined {
    const decoder = new TextDecoder();
    let offset = 0;
    for (;;) {
      if (offset + 4 > buffer.length) return undefined;
      const length = Number.parseInt(
        decoder.decode(buffer.slice(offset, offset + 4)),
        16,
      );
      if (Number.isNaN(length)) return undefined;
      if (length === 0) {
        offset += 4;
        continue;
      }
      if (offset + length > buffer.length) return undefined;
      const payload = decoder.decode(buffer.slice(offset + 4, offset + length));
      if (payload.startsWith("# service=")) {
        offset += length;
        continue;
      }
      return { start: offset, end: offset + length };
    }
  }

  /**
   * The response a client reads as "the server refused every ref, saying
   * why": a `report-status`, inside side-band 1 when the client asked for
   * side-band. Undefined when the client asked for no report, and gets a
   * plain 403 instead.
   */
  public refusal(
    commands: GitRefCommand[],
    capabilities: string[],
    reason: string,
  ): Uint8Array | undefined {
    if (
      !capabilities.includes("report-status") &&
      !capabilities.includes("report-status-v2")
    ) {
      return undefined;
    }
    const report = this.concat(
      this.pkt("unpack ok\n"),
      ...commands.map((command) => this.pkt(`ng ${command.ref} ${reason}\n`)),
      this.flush(),
    );
    if (
      !capabilities.includes("side-band-64k") &&
      !capabilities.includes("side-band")
    ) {
      return report;
    }
    const max = capabilities.includes("side-band-64k") ? 65515 : 995;
    const packets: Uint8Array[] = [];
    for (let i = 0; i < report.length; i += max) {
      packets.push(
        this.pkt(this.concat(new Uint8Array([1]), report.slice(i, i + max))),
      );
    }
    return this.concat(...packets, this.flush());
  }

  /**
   * One pkt-line: four hex digits of length, then the payload.
   */
  public pkt(payload: string | Uint8Array): Uint8Array {
    const bytes =
      typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
    const length = new TextEncoder().encode(
      (bytes.length + 4).toString(16).padStart(4, "0"),
    );
    return this.concat(length, bytes);
  }

  public flush(): Uint8Array {
    return new TextEncoder().encode("0000");
  }

  /**
   * Parse what the buffer holds: the commands up to the first flush, then,
   * when `push-options` was asked, the options up to the second.
   */
  protected parseHead(
    buffer: Uint8Array,
    ended = false,
  ): {
    complete: boolean;
    commands: GitRefCommand[];
    capabilities: string[];
    pushOptions: string[];
    headEnd: number;
  } {
    const decoder = new TextDecoder();
    const commands: GitRefCommand[] = [];
    const pushOptions: string[] = [];
    let capabilities: string[] = [];
    let offset = 0;
    let section: "commands" | "options" = "commands";
    for (;;) {
      if (offset + 4 > buffer.length) {
        return {
          complete: ended,
          commands,
          capabilities,
          pushOptions,
          headEnd: offset,
        };
      }
      const length = Number.parseInt(
        decoder.decode(buffer.slice(offset, offset + 4)),
        16,
      );
      if (Number.isNaN(length)) {
        return {
          complete: true,
          commands,
          capabilities,
          pushOptions,
          headEnd: offset,
        };
      }
      if (length === 0) {
        offset += 4;
        if (section === "commands" && capabilities.includes("push-options")) {
          section = "options";
          continue;
        }
        return {
          complete: true,
          commands,
          capabilities,
          pushOptions,
          headEnd: offset,
        };
      }
      if (offset + length > buffer.length) {
        return {
          complete: ended,
          commands,
          capabilities,
          pushOptions,
          headEnd: offset,
        };
      }
      const line = decoder
        .decode(buffer.slice(offset + 4, offset + length))
        .replace(/\n$/, "");
      offset += length;
      if (section === "options") {
        pushOptions.push(line);
        continue;
      }
      const [command, caps] = line.split("\0");
      if (caps !== undefined) capabilities = caps.trim().split(/\s+/);
      const [oldId, newId, ref] = (command ?? "").split(" ");
      if (oldId && newId && ref) {
        commands.push({ oldId, newId, ref });
      }
    }
  }

  /**
   * The buffered head, then whatever the reader still has.
   */
  protected replay(
    head: Uint8Array,
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    let sent = head.length === 0;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (!sent) {
          sent = true;
          controller.enqueue(head);
          return;
        }
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel: (reason) => reader.cancel(reason),
    });
  }

  protected concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, it) => sum + it.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

/**
 * One ref update a push asks for.
 */
export interface GitRefCommand {
  oldId: string;
  newId: string;
  ref: string;
}
