import { $inject, Alepha } from "alepha";

import type { ActorRequest } from "../interfaces/ActorInterfaces.ts";
import { ActorCodec } from "./ActorCodec.ts";
import { ActorHostRuntime } from "./ActorHostRuntime.ts";
import { ActorProvider } from "./ActorProvider.ts";
export interface ActorStub {
  executeActor(identity: string, request: ActorRequest): Promise<string>;
}
/**
 * Routes independent encoded actor identities to the shared native host.
 * A missing ALEPHA_ACTOR binding is an error, never a Memory fallback.
 */
export class CloudflareActorProvider extends ActorProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly runtime = $inject(ActorHostRuntime);
  protected readonly codec = $inject(ActorCodec);
  public override async execute(request: ActorRequest): Promise<unknown> {
    const identity = this.codec.identity(
      String(this.alepha.env.ALEPHA_ACTOR_NAMESPACE ?? ""),
      request.name,
      request.key,
    );
    const namespace = this.runtime.namespace<ActorStub>("ALEPHA_ACTOR");
    const result = await namespace
      .get(namespace.idFromName(identity))
      .executeActor(identity, {
        ...request,
        args: this.codec.copy(request.args),
      });
    // RPC annotates object results with disposers. JSON text keeps the wire
    // result primitive and leaves application JSON validation strict.
    return this.codec.copy(JSON.parse(result));
  }
}
