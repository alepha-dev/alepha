import { $inject, AlephaError } from "alepha";
import { PlatformHook, type PlatformHookContext } from "alepha/cli/platform";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import Stripe from "stripe";

const WEBHOOK_PATH = "/api/payments/webhook";
const API_KEY_VAR = "STRIPE_SECRET_KEY";
const WEBHOOK_SECRET_VAR = "STRIPE_WEBHOOK_SECRET";

const EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "payment_intent.processing",
  "charge.refunded",
];

/**
 * Provisions the Stripe webhook endpoint for a deployment.
 *
 * On `register`:
 * - Computes the webhook URL from `baseUrl + /api/payments/webhook`.
 * - Finds or creates a webhook endpoint in Stripe tagged with metadata
 *   identifying this project+env.
 * - Writes the signing secret to `.env.<env>` so it gets pushed to the
 *   worker by the orchestrator's secrets step.
 *
 * On `unregister`: deletes the matching endpoint if present.
 *
 * Activation: the hook self-skips when `STRIPE_SECRET_KEY` is not set in
 * `process.env` or `.env.<env>`, so adding the plugin to a project that
 * doesn't use Stripe is a no-op.
 */
export class StripePlatformHook extends PlatformHook {
  public readonly name = "stripe-webhook";
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);

  public async register(ctx: PlatformHookContext): Promise<void> {
    const apiKey = await this.readEnvVar(ctx, API_KEY_VAR);
    if (!apiKey) {
      this.log.debug(
        `Stripe hook skipped: ${API_KEY_VAR} not set for env "${ctx.env}"`,
      );
      return;
    }

    const stripe = new Stripe(apiKey);
    const url = `${ctx.baseUrl}${WEBHOOK_PATH}`;
    const metadata = this.metadata(ctx);
    const existing = await this.findByUrl(stripe, url);
    const storedSecret = await this.readEnvVar(ctx, WEBHOOK_SECRET_VAR);

    if (existing && storedSecret) {
      // Already provisioned: update events/metadata in case they drifted.
      await stripe.webhookEndpoints.update(existing.id, {
        enabled_events: EVENTS,
        disabled: false,
        metadata,
      });
      this.log.info(`Stripe webhook up-to-date: ${url}`);
      return;
    }

    // Either no endpoint at all, or endpoint exists but we lost the
    // signing secret (Stripe only returns it on create). Recreate.
    if (existing) {
      this.log.warn(
        `Stripe webhook exists but ${WEBHOOK_SECRET_VAR} is missing locally; recreating`,
      );
      await stripe.webhookEndpoints.del(existing.id);
    }

    const created = await stripe.webhookEndpoints.create({
      url,
      enabled_events: EVENTS,
      metadata,
    });
    if (!created.secret) {
      throw new AlephaError("Stripe did not return a webhook signing secret");
    }

    await this.writeEnvVar(ctx, WEBHOOK_SECRET_VAR, created.secret);
    this.log.info(
      `Stripe webhook created: ${url} (secret written to .env.${ctx.env})`,
    );
  }

  public async unregister(ctx: PlatformHookContext): Promise<void> {
    const apiKey = await this.readEnvVar(ctx, API_KEY_VAR);
    if (!apiKey) return;

    const stripe = new Stripe(apiKey);
    const url = `${ctx.baseUrl}${WEBHOOK_PATH}`;
    const existing = await this.findByUrl(stripe, url);
    if (!existing) return;

    await stripe.webhookEndpoints.del(existing.id);
    this.log.info(`Stripe webhook removed: ${url}`);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  protected async findByUrl(stripe: Stripe, url: string) {
    // Stripe caps at 100 per page; webhook count is low by design.
    const page = await stripe.webhookEndpoints.list({ limit: 100 });
    return page.data.find((e) => e.url === url);
  }

  protected metadata(ctx: PlatformHookContext): Record<string, string> {
    return {
      alepha_project: ctx.project,
      alepha_env: ctx.env,
    };
  }

  protected envFilePath(ctx: PlatformHookContext): string {
    return this.fs.join(ctx.root, `.env.${ctx.env}`);
  }

  protected async readEnvVar(
    ctx: PlatformHookContext,
    key: string,
  ): Promise<string | undefined> {
    if (process.env[key]) return process.env[key];

    const path = this.envFilePath(ctx);
    if (!(await this.fs.exists(path))) return undefined;

    const content = (await this.fs.readFile(path)).toString("utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      if (trimmed.slice(0, eq).trim() !== key) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        value.length >= 2 &&
        ((value[0] === '"' && value[value.length - 1] === '"') ||
          (value[0] === "'" && value[value.length - 1] === "'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
    return undefined;
  }

  protected async writeEnvVar(
    ctx: PlatformHookContext,
    key: string,
    value: string,
  ): Promise<void> {
    const path = this.envFilePath(ctx);
    const exists = await this.fs.exists(path);
    const existing = exists
      ? (await this.fs.readFile(path)).toString("utf8")
      : "";

    const line = `${key}=${value}`;
    const lines = existing.split("\n");
    let replaced = false;
    const next = lines.map((l) => {
      const trimmed = l.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) return l;
      const k = trimmed.slice(0, trimmed.indexOf("=")).trim();
      if (k === key) {
        replaced = true;
        return line;
      }
      return l;
    });

    let output = next.join("\n");
    if (!replaced) {
      if (output.length > 0 && !output.endsWith("\n")) output += "\n";
      output += `${line}\n`;
    }
    await this.fs.writeFile(path, output);
  }
}
