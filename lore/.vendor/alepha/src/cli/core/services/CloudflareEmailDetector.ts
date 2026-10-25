import { type Alepha, AlephaError } from "alepha";
import { CloudflareEmailProvider } from "alepha/email/cloudflare";

/**
 * Whether the workspace app registered the Cloudflare email provider, so the
 * build emits the `send_email` binding (wrangler.jsonc) and records it in the
 * manifest (prebuilt deploys re-emit it from there).
 *
 * ## ⚠️ Why a miss can throw
 *
 * The build tasks run in the CLI's Alepha context while `ctx.alepha` is the
 * workspace's own, so the provider is resolved by its stable `id`, never by
 * class identity. When that lookup silently failed (the provider had no `id`
 * after string lookups moved from class names to ids), every Cloudflare build
 * dropped `send_email` behind a green deploy and the worker could not send a
 * single email. So a miss is cross-checked against the module graph: the app
 * registering `alepha.email.cloudflare` while the id lookup finds nothing is
 * a build error, not "this app sends no email".
 */
export class CloudflareEmailDetector {
  public readonly providerId: string = CloudflareEmailProvider.id;
  public readonly moduleName = "alepha.email.cloudflare";

  public detect(alepha: Pick<Alepha, "inject" | "graph">): boolean {
    try {
      alepha.inject(this.providerId);
      return true;
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
          "not resolvable by id: the build would drop the Cloudflare " +
          "`send_email` binding and the worker could not send email.",
      );
    }
    return false;
  }

  protected isNotFound(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message === `Service not found: ${this.providerId}`
    );
  }
}
