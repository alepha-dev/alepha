import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import type { ComponentType } from "react";

/**
 * The outcome of the browser's first screen, once per boot.
 *
 * `ready` resolving, a loader finishing and `react:transition:end` all happen
 * before React has put anything on the screen, so none of them proves the app
 * booted. This does: `healthy` is reported by an effect inside the committed
 * page (or the committed offline screen), `failed` by an error layer, an error
 * React caught or did not catch during the first render, or a first render
 * that threw. Whichever comes first is the outcome; nothing after it changes
 * it.
 *
 * Consumers: a native splash screen hides on either outcome; a live updater
 * acknowledges a bundle on `healthy` only. Both read {@link settled} or listen
 * to `react:boot:settled`.
 */
export class ReactBootHealth {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  /**
   * The outcome, once there is one.
   */
  public outcome?: ReactBootOutcome;

  protected resolveSettled?: (outcome: ReactBootOutcome) => void;

  protected readonly settledPromise = new Promise<ReactBootOutcome>(
    (resolve) => {
      this.resolveSettled = resolve;
    },
  );

  /**
   * The app's own offline screen, used instead of the router's plain one.
   * Set it before the app starts, e.g. in a module's `register`.
   */
  public offlineScreen?: ComponentType<OfflineScreenProps>;

  protected readonly bootTasks: Array<() => Promise<void>> = [];

  /**
   * Work the first transition must wait for, run just before it: restoring a
   * stored session is the case. Inside the boot deadline when the bounded
   * boot is on, so a task waiting on an unreachable API ends on the offline
   * screen like a loader would; a task that throws a network error does too.
   * Run again by the offline screen's retry. Register before `ready`.
   */
  public addBootTask(task: () => Promise<void>): void {
    this.bootTasks.push(task);
  }

  /**
   * Run the boot tasks, in order.
   */
  public async runBootTasks(): Promise<void> {
    for (const task of this.bootTasks) {
      await task();
    }
  }

  /**
   * Resolves with the outcome, whenever it is (or was) reported.
   */
  public settled(): Promise<ReactBootOutcome> {
    return this.settledPromise;
  }

  /**
   * Record the outcome. Only the first call counts.
   */
  public report(outcome: ReactBootOutcome, error?: unknown): void {
    if (this.outcome) {
      return;
    }
    this.outcome = outcome;
    this.log.debug(`Boot ${outcome}`);
    this.resolveSettled?.(outcome);
    this.alepha.events
      .emit("react:boot:settled", { outcome, error })
      .catch((err) => this.log.error("Failed to emit react:boot:settled", err));
  }

  /**
   * Whether an error means the request got no HTTP response: the network is
   * down, the host unreachable, or the request aborted. Any response at all,
   * a 500 included, is not offline: the API is there and answered.
   *
   * Read through the `cause` chain, since a client may wrap the failure.
   */
  public isNetworkError(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; current && depth < 5; depth++) {
      if (typeof current !== "object") {
        return false;
      }
      const it = current as {
        name?: string;
        message?: string;
        cause?: unknown;
      };
      if (it.name === "AbortError") {
        return true;
      }
      if (
        it.name === "TypeError" &&
        /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(
          it.message ?? "",
        )
      ) {
        return true;
      }
      current = it.cause;
    }
    return false;
  }
}

/**
 * `healthy`: a page, or the offline screen, is on the screen. `failed`: an
 * error is.
 */
export type ReactBootOutcome = "healthy" | "failed";

/**
 * What an offline screen is given.
 */
export interface OfflineScreenProps {
  /**
   * `network`: a request got no response. `deadline`: the first transition
   * took longer than the boot deadline.
   */
  reason: "network" | "deadline";

  /**
   * Run the transition for the current URL again. Resolves once it settled,
   * on the page or back on this screen.
   */
  retry: () => Promise<void>;
}
