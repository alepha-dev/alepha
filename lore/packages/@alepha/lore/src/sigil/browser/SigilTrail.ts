import {
  SIGIL_FEEDBACK_TRAIL_LIMITS,
  type SigilFeedbackTrail,
} from "../shared/sigilFeedbackTrail.ts";

/**
 * The feedback trail's ring buffers (#Q4038): the last crashes, paths and
 * actions, capped, in memory only. `SigilBrowserProvider` fills it from the
 * sources it already listens to; the feedback button reads a copy when the
 * visitor files a report. It does not care what the sink's `enabled` flags
 * say: it serves the button, not analytics, and leaves the page only in a
 * report the visitor sends.
 */
export class SigilTrail {
  protected readonly errors: SigilFeedbackTrail["errors"] = [];
  protected readonly pages: SigilFeedbackTrail["pages"] = [];
  protected readonly actions: SigilFeedbackTrail["actions"] = [];
  /**
   * Actions begun and not yet ended, oldest first, per name: an end closes
   * the oldest of its name.
   */
  protected readonly open = new Map<string, number[]>();

  protected readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  public addError(message: string, path: string): void {
    this.push(
      this.errors,
      {
        message: message.slice(0, SIGIL_FEEDBACK_TRAIL_LIMITS.message),
        path: path.slice(0, SIGIL_FEEDBACK_TRAIL_LIMITS.path),
        at: this.now(),
      },
      SIGIL_FEEDBACK_TRAIL_LIMITS.errors,
    );
  }

  public addPage(path: string): void {
    const last = this.pages.at(-1);
    if (last?.path === path) return;
    this.push(
      this.pages,
      { path: path.slice(0, SIGIL_FEEDBACK_TRAIL_LIMITS.path), at: this.now() },
      SIGIL_FEEDBACK_TRAIL_LIMITS.pages,
    );
  }

  public beginAction(name: string): void {
    const started = this.open.get(name) ?? [];
    started.push(this.now());
    // An action that never ends must not grow the map forever.
    if (started.length > SIGIL_FEEDBACK_TRAIL_LIMITS.actions) started.shift();
    this.open.set(name, started);
  }

  public endAction(name: string, outcome: "success" | "error"): void {
    const started = this.open.get(name)?.shift();
    this.push(
      this.actions,
      {
        name: name.slice(0, SIGIL_FEEDBACK_TRAIL_LIMITS.name),
        outcome,
        ms: started === undefined ? 0 : Math.max(0, this.now() - started),
      },
      SIGIL_FEEDBACK_TRAIL_LIMITS.actions,
    );
  }

  /**
   * A copy, for the popup: the buffers keep filling after it is taken.
   */
  public snapshot(): SigilFeedbackTrail {
    return {
      errors: this.errors.map((it) => ({ ...it })),
      pages: this.pages.map((it) => ({ ...it })),
      actions: this.actions.map((it) => ({ ...it })),
    };
  }

  protected push<T>(list: T[], item: T, cap: number): void {
    list.push(item);
    while (list.length > cap) list.shift();
  }
}
