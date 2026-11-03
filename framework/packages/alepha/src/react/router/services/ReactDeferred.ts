/**
 * The deferred values of a page: promises at the top level of what a loader
 * returned, which the page reads with `use()` inside a `<Suspense>`.
 *
 * A value travels in one of two ways. Settled by the time `#__ssr` is written,
 * it is in the payload with its state. Still pending, the payload says so and
 * an inline script delivers it later (`DeferredScript`).
 */
export class ReactDeferred {
  protected readonly settledCache = new WeakMap<object, DeferredPromise>();

  /**
   * The name of the global the inline scripts write to, before and after the
   * entry has booted.
   */
  public readonly queue = "__alephaDeferred";

  public isDeferred(value: unknown): value is DeferredPromise {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { then?: unknown }).then === "function"
    );
  }

  /**
   * The deferred values of a layer's props. Top level only: a promise nested
   * in an object is not looked at.
   */
  public entries(
    props: Record<string, unknown> | undefined,
  ): Array<[string, DeferredPromise]> {
    return Object.entries(props ?? {}).filter(
      (entry): entry is [string, DeferredPromise] => this.isDeferred(entry[1]),
    );
  }

  public has(layers: Array<{ props?: Record<string, unknown> }>): boolean {
    return layers.some((layer) => this.entries(layer.props).length > 0);
  }

  /**
   * Stamp `status` on each deferred value the way `use()` reads it, so a
   * settled one reads synchronously. It also observes the rejection: nothing
   * may have read the value yet, and an unobserved rejection ends a Node
   * process.
   */
  public track(props: Record<string, unknown> | undefined): void {
    for (const [, promise] of this.entries(props)) {
      if (promise.status) {
        continue;
      }
      promise.status = "pending";
      promise.then(
        (value) => {
          promise.status = "fulfilled";
          promise.value = value;
        },
        (reason) => {
          promise.status = "rejected";
          promise.reason = reason;
        },
      );
    }
  }

  /**
   * Wait for every deferred value of these layers, failures included.
   */
  public async settle(
    layers: Array<{ props?: Record<string, unknown> }>,
  ): Promise<void> {
    await Promise.allSettled(
      layers.flatMap((layer) =>
        this.entries(layer.props).map(([, promise]) => promise),
      ),
    );
  }

  /**
   * A promise for "this value is settled", never rejecting, that `use()` reads
   * synchronously once it is. One per value: `use()` needs the same promise on
   * every attempt.
   */
  public settled(promise: DeferredPromise): DeferredPromise {
    let settled = this.settledCache.get(promise);
    if (!settled) {
      settled = promise.then(
        () => undefined,
        () => undefined,
      ) as DeferredPromise;
      if (promise.status !== "pending") {
        settled.status = "fulfilled";
        settled.value = undefined;
      }
      this.settledCache.set(promise, settled);
    }
    return settled;
  }

  /**
   * A layer's props as the payload carries them.
   */
  public serialize(
    props: Record<string, unknown> | undefined,
    index: number,
  ): Record<string, unknown> | undefined {
    if (!props) {
      return props;
    }
    const out = { ...props };
    for (const [key, promise] of this.entries(props)) {
      out[key] = {
        $deferred: this.describe(promise),
        id: this.id(index, key),
      };
    }
    return out;
  }

  public id(index: number, key: string): string {
    return `${index}:${key}`;
  }

  /**
   * The inline script delivering a settled value.
   */
  public deliveryScript(id: string, promise: DeferredPromise): string {
    const entry = JSON.stringify([id, this.describe(promise)])
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(new RegExp("\\u2028", "g"), "\\u2028")
      .replace(new RegExp("\\u2029", "g"), "\\u2029");
    return `(self.${this.queue}=self.${this.queue}||[]).push(${entry})`;
  }

  /**
   * A value's state in the form that crosses to the browser. An error keeps
   * `name`, `message` and `status`, so `isHttpError` works on the other side.
   */
  protected describe(promise: DeferredPromise): DeferredState {
    if (promise.status === "fulfilled") {
      return { status: "fulfilled", value: promise.value };
    }
    if (promise.status === "rejected") {
      const reason = promise.reason as
        | {
            name?: string;
            message?: string;
            status?: number;
            data?: { status?: number };
          }
        | undefined;
      return {
        status: "rejected",
        error: {
          name: reason?.name ?? "Error",
          message: reason?.message ?? "A deferred value was rejected",
          status: reason?.status ?? reason?.data?.status,
        },
      };
    }
    return { status: "pending" };
  }

  /**
   * Turn the payload's markers back into promises, in place. A settled value
   * is a promise with `status` and `value` already set, so `use()` reads it
   * synchronously and hydration does not suspend.
   */
  public revive(
    layers: Array<{ props?: Record<string, unknown> }>,
    target: DeferredWindow = self as unknown as DeferredWindow,
  ): void {
    const waiting = new Map<string, DeferredPromise>();

    for (const layer of layers) {
      for (const [key, value] of Object.entries(layer.props ?? {})) {
        const marker = value as DeferredMarker | undefined;
        if (!marker?.$deferred) {
          continue;
        }
        const promise = this.promiseOf(marker.$deferred);
        layer.props![key] = promise;
        if (marker.$deferred.status === "pending") {
          waiting.set(marker.id, promise);
        }
      }
    }

    if (waiting.size === 0) {
      return;
    }

    const deliver = ([id, state]: [string, DeferredState]) => {
      const promise = waiting.get(id);
      if (promise) {
        this.settleFrom(promise, state);
      }
    };

    const delivered = target[this.queue] ?? [];
    target[this.queue] = { push: deliver };
    for (const entry of delivered as Array<[string, DeferredState]>) {
      deliver(entry);
    }
  }

  protected promiseOf(state: DeferredState): DeferredPromise {
    if (state.status === "pending") {
      let resolve!: (value: unknown) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      }) as DeferredPromise;
      promise.resolve = resolve;
      promise.reject = reject;
      promise.status = "pending";
      promise.catch(() => undefined);
      return promise;
    }

    const promise = (
      state.status === "fulfilled"
        ? Promise.resolve(state.value)
        : Promise.reject(this.errorOf(state))
    ) as DeferredPromise;
    promise.catch(() => undefined);
    promise.status = state.status;
    if (state.status === "fulfilled") {
      promise.value = state.value;
    } else {
      promise.reason = this.errorOf(state);
    }
    return promise;
  }

  protected settleFrom(promise: DeferredPromise, state: DeferredState): void {
    if (state.status === "fulfilled") {
      promise.status = "fulfilled";
      promise.value = state.value;
      promise.resolve?.(state.value);
    } else if (state.status === "rejected") {
      const reason = this.errorOf(state);
      promise.status = "rejected";
      promise.reason = reason;
      promise.reject?.(reason);
    }
  }

  protected errorOf(state: DeferredState): Error {
    const error = new Error(state.error?.message);
    error.name = state.error?.name ?? "Error";
    return Object.assign(error, { status: state.error?.status });
  }
}

/**
 * A promise carrying the fields `use()` reads.
 */
export type DeferredPromise = Promise<unknown> & {
  status?: "pending" | "fulfilled" | "rejected";
  value?: unknown;
  reason?: unknown;
  resolve?: (value: unknown) => void;
  reject?: (reason: unknown) => void;
};

export interface DeferredState {
  status: "pending" | "fulfilled" | "rejected";
  value?: unknown;
  error?: { name: string; message: string; status?: number };
}

interface DeferredMarker {
  $deferred?: DeferredState;
  id: string;
}

type DeferredWindow = Record<
  string,
  | Array<[string, DeferredState]>
  | { push: (entry: [string, DeferredState]) => void }
  | undefined
>;
