import { $hook, $inject, Alepha } from "alepha";

/**
 * Request-scoped memo for the reads `$owns` performs to make its decision.
 *
 * A page that loads seven things at once sends one `POST /api/_batch`, and
 * every entry gates independently. Without this, one `(user, project)` pair is
 * resolved seven times over: seven authority reads and seven membership reads,
 * inside a single HTTP request.
 *
 * ## What it caches, and what it deliberately does not
 *
 * The gate's own reads: the **authority row** it decides against, and the
 * **membership row** that decides it. Not the resource row a `through` gate
 * loads on the way - that is the row the handler is about to work on, and a
 * handler must always see what its own gate just read rather than a copy a
 * sibling action took before writing to it.
 *
 * ## Why the promise, not the value
 *
 * Batch entries start concurrently. Storing the resolved value would have all
 * seven miss, since none has finished when the others look. Storing the
 * in-flight promise is what makes six of them await the first one's query.
 *
 * ## Why it is seeded from a hook and never lazily
 *
 * `AlsProvider.set` writes into `als.getStore()` - the **innermost** layer -
 * and `$action.run()` forks a fresh layer per action. A memo created on demand
 * inside the guard therefore lands in that one action's fork and is invisible
 * to its six siblings.
 *
 * That failure is the quiet kind: every gate still allows, every behavioural
 * test still passes, and the batch still issues seven lookups. Seeding on
 * `server:onRequest` puts the `Map` on the request layer, which reads fall
 * through to from every child fork, so each action finds the same object and
 * mutates it by reference.
 *
 * ## Why a request is a safe boundary
 *
 * The memo never outlives one request, and a request is already the atomic
 * unit of authorization: nothing re-checks membership mid-request expecting a
 * different answer. So this preserves revocation semantics exactly - unlike a
 * cross-request TTL, which would trade them for a window.
 *
 * With no seeded memo (a job, a CLI command, a direct `run()` in a test) every
 * read simply happens, which is the behaviour these had before it existed.
 */
export class ResourceGateMemoProvider {
  protected readonly alepha = $inject(Alepha);

  /**
   * ALS key the per-request `Map` lives under.
   */
  static readonly KEY = "alepha.security.resourceGateMemo";

  protected readonly onServerRequest = $hook({
    on: "server:onRequest",
    // Nothing consumes the memo during `onRequest`, so this is only about
    // being cheap and unconditional: a hook that failed earlier in the chain
    // must not be able to leave the memo unseeded for the handlers.
    priority: "first",
    handler: () => {
      this.alepha.context.set(
        ResourceGateMemoProvider.KEY,
        new Map<string, Promise<unknown>>(),
      );
    },
  });

  /**
   * Run `load` once per `key` for the lifetime of the current request.
   *
   * Falls straight through to `load` when there is no request layer to hang a
   * memo on, so the caller never has to ask which transport it is on.
   */
  public resolve<T>(key: string, load: () => Promise<T>): Promise<T> {
    const memo = this.alepha.context.get<Map<string, Promise<unknown>>>(
      ResourceGateMemoProvider.KEY,
    );

    if (!memo) {
      return load();
    }

    const inFlight = memo.get(key);
    if (inFlight) {
      return inFlight as Promise<T>;
    }

    const pending = load();
    memo.set(key, pending);

    // Evict a failed read so a later gate in the same request retries instead
    // of inheriting a transient error. Attaching the handler here also keeps
    // the rejection from being unobserved when nothing awaits this entry yet;
    // the rejection itself still reaches whoever awaits `pending`.
    pending.catch(() => memo.delete(key));

    return pending;
  }
}
