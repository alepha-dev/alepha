import { type Alepha, AlephaError } from "alepha";
import { WorkersAiProvider } from "alepha/ai/cloudflare";

/**
 * Which Workers AI binding the workspace app needs, when it registered
 * `AlephaAiCloudflare`, so the build emits `"ai": { "binding": ... }`
 * (wrangler.jsonc) and records it in the manifest (prebuilt deploys re-emit
 * it from there).
 *
 * Resolved by the provider's stable `id`, never by class identity: the build
 * tasks run in the CLI's container while `ctx.alepha` is the workspace's
 * own. As for email (`CloudflareEmailDetector`), a miss while the module is
 * registered is a build error, not "this app uses no AI": otherwise the
 * deploy would drop the binding behind a green build and the first chat on
 * Workers would fail.
 */
export class CloudflareAiDetector {
  public readonly providerId: string = WorkersAiProvider.id;
  public readonly moduleName = "alepha.ai.cloudflare";

  /**
   * The binding name, or `undefined` when the app does not use Workers AI.
   */
  public detect(alepha: Pick<Alepha, "inject" | "graph">): string | undefined {
    try {
      const provider = alepha.inject(this.providerId) as {
        bindingName?: string;
      };
      return provider.bindingName || "AI";
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw error;
      }
    }

    const registered = Object.values(alepha.graph()).some(
      (entry) => entry.module === this.moduleName,
    );
    if (registered) {
      throw new AlephaError(
        `The app registers '${this.moduleName}' but '${this.providerId}' is ` +
          "not resolvable by id: the build would drop the Workers AI `ai` " +
          "binding and every chat on Workers would fail.",
      );
    }
    return undefined;
  }

  protected isNotFound(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message === `Service not found: ${this.providerId}`
    );
  }
}
