import { $inject, Alepha, AlephaError } from "alepha";
export interface ActorNamespace<T = unknown> {
  idFromName(name: string): { toString(): string };
  get(id: unknown): T;
}
/**
 * Common app/environment resolution, namespace lookup and specialized startup.
 * Actor dispatch resolves declarations without invoking full start hooks.
 */
export class ActorHostRuntime {
  protected readonly alepha = $inject(Alepha);
  public static resolve(env: Record<string, unknown>): Alepha {
    const app = (globalThis as any).__alepha as Alepha | undefined;
    if (!app)
      throw new AlephaError("__alepha not found in Durable Object isolate");
    app.inject(ActorHostRuntime).bind(env);
    return app;
  }
  public bind(env: Record<string, unknown>): void {
    this.alepha.set("cloudflare.env", env);
    this.alepha.loadEnv(env);
  }
  public namespace<T>(binding: string): ActorNamespace<T> {
    const env = this.alepha.store.get("cloudflare.env") as
      | Record<string, unknown>
      | undefined;
    const namespace = env?.[binding] as ActorNamespace<T> | undefined;
    if (
      !namespace ||
      typeof namespace.idFromName !== "function" ||
      typeof namespace.get !== "function"
    )
      throw new AlephaError(
        `Durable Object binding '${binding}' not found in Cloudflare Workers environment`,
      );
    return namespace;
  }
  public ensureStarted(env: Record<string, unknown>): Promise<Alepha> {
    this.bind(env);
    // Alepha.start owns pending-start memoization, failures and stale-start recovery.
    return this.alepha.start().then(() => this.alepha);
  }
}
