import { DurableObject } from "cloudflare:workers";

import type { ActorRequest } from "../interfaces/ActorInterfaces.ts";
import { ActorHost } from "./ActorHost.ts";
/**
 * Native workerd-only adapter for the shared actor host.
 */
export class AlephaActorDurableObject extends DurableObject {
  protected readonly actor: ActorHost;
  constructor(ctx: any, env: any) {
    super(ctx, env);
    this.actor = new ActorHost(this.ctx.storage, this.env, this.ctx.id);
  }
  /**
   * Answers a JSON reply, `{ value }` or `{ error: { name, message } }`, and
   * never throws. Thrown across RPC, an error loses its class: it arrives as a
   * plain `Error`. At the compatibility date `alepha build` writes
   * (2026-11-03) it keeps its `name` and `message`; at 2025-11-17, the date
   * before, the message became "AlephaError: ..." (measured 2026-11-05 on
   * workerd 1.20261103.1). As data, a reducer's refusal reaches the caller as
   * it does on Memory and Redis, whatever the date.
   */
  public async executeActor(
    identity: string,
    request: ActorRequest,
  ): Promise<string> {
    try {
      return JSON.stringify({
        value: await this.actor.execute(identity, request),
      });
    } catch (error) {
      return JSON.stringify({
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { name: "Error", message: String(error) },
      });
    }
  }
  /**
   * Reclaims an expired actor's storage; armed by the host on expiring writes.
   */
  public async alarm(): Promise<void> {
    await this.actor.alarm();
  }
}
