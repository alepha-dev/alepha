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
  public async executeActor(
    identity: string,
    request: ActorRequest,
  ): Promise<string> {
    return JSON.stringify(await this.actor.execute(identity, request));
  }
}
