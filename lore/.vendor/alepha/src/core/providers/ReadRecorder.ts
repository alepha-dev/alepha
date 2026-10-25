/**
 * What a render read that decides whether its output can be shared.
 */
export interface RecordedRead {
  /**
   * What was read: `atom` (a personal atom), `write` (a personal atom
   * written), `request` (the raw request), `cookie` (a cookie read by page
   * code), `set-cookie`, `user` (`state.user`), `remote` (a remote call
   * carrying the visitor's credential), `lang`.
   */
  kind: string;

  /**
   * The state key, cookie name or action, whichever names the read.
   */
  key: string;

  /**
   * A few stack frames naming the code that read it. Captured for the first
   * personal read only, and only when the recorder was created with
   * `captureSource` (development).
   */
  source?: string;
}

/**
 * Whether a page may be shared: `shared` read nothing personal, `variant`
 * read only the language, `personal` read anything about the visitor.
 */
export type ReadVerdict = "shared" | "variant" | "personal";

/**
 * Records, for one request, the reads that make a page personal (#E78).
 *
 * Installed in the request's store fork by the page handler
 * ({@link StateManager.startRecording}); every nested fork reaches it through
 * the parent walk, so middleware, render hooks, loaders, in-process actions
 * and the React render all report to the same recorder.
 *
 * Fail closed: the caller decides what is personal, and anything it reports
 * here makes the verdict personal. A wrong report costs a cache miss, never a
 * leak.
 */
export class ReadRecorder {
  /**
   * The first personal read, the one a developer needs to see.
   */
  public first?: RecordedRead;

  /**
   * How many personal reads were reported.
   */
  public personalCount = 0;

  /**
   * Whether the language was read.
   */
  public variant = false;

  /**
   * Writes count only once this is true. The page handler opens it when the
   * render proper starts (loaders, React): what runs before it (middleware,
   * `react:server:render:begin` hooks) runs again on every cache hit, so its
   * writes reach the private script either way.
   */
  public writesTracked = false;

  /**
   * Suspends recording, for framework bookkeeping that reads personal state
   * without letting it reach the markup.
   */
  protected paused = 0;

  /**
   * Capture the source of the first personal read (development).
   */
  public readonly captureSource: boolean;

  constructor(captureSource = false) {
    this.captureSource = captureSource;
  }

  /**
   * Report a read that makes the page personal.
   */
  public personal(read: RecordedRead): void {
    if (this.paused > 0) {
      return;
    }
    if (read.kind === "write" && !this.writesTracked) {
      return;
    }
    this.personalCount++;
    if (!this.first) {
      this.first = this.captureSource
        ? { ...read, source: this.captureStack() }
        : read;
    }
  }

  /**
   * Report a read of the language: the page varies by language only.
   */
  public lang(): void {
    if (this.paused === 0) {
      this.variant = true;
    }
  }

  /**
   * Run `fn` without recording anything it reads. Synchronous only: an
   * awaited callback would let other work of the same request run unseen.
   */
  public untracked<T>(fn: () => T): T {
    this.paused++;
    try {
      return fn();
    } finally {
      this.paused--;
    }
  }

  public verdict(): ReadVerdict {
    if (this.personalCount > 0) {
      return "personal";
    }
    return this.variant ? "variant" : "shared";
  }

  /**
   * One line naming the first personal read, for a header or a log.
   */
  public describe(): string | undefined {
    if (!this.first) {
      return undefined;
    }
    return `${this.first.kind}:${this.first.key}`;
  }

  protected captureStack(): string | undefined {
    const stack = new Error("read").stack;
    if (!stack) {
      return undefined;
    }
    // Skip the frames of the recorder and the state manager themselves.
    return stack
      .split("\n")
      .slice(1)
      .filter(
        (line) =>
          !line.includes("ReadRecorder") &&
          !line.includes("StateManager") &&
          !line.includes("node:internal"),
      )
      .slice(0, 6)
      .map((line) => line.trim())
      .join("\n");
  }
}
