import { $inject, Alepha, AlephaError } from "alepha";

import type { ActorRequest } from "../interfaces/ActorInterfaces.ts";
import { ActorCodec } from "./ActorCodec.ts";
import { ActorHostRuntime } from "./ActorHostRuntime.ts";
import { ActorProvider } from "./ActorProvider.ts";
/**
 * What `executeActor` answers: the committed state, or the error it refused
 * with, carried as data.
 */
export interface ActorReply {
  value?: unknown;
  error?: { name: string; message: string };
}
export interface ActorStub {
  executeActor(identity: string, request: ActorRequest): Promise<string>;
}
/**
 * Routes independent encoded actor identities to the shared native host.
 * A missing ALEPHA_ACTOR binding is an error, never a Memory fallback.
 * A refused call rethrows an `AlephaError` carrying the host error's message
 * and name; its class does not cross the Durable Object boundary.
 */
export class CloudflareActorProvider extends ActorProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly runtime = $inject(ActorHostRuntime);
  protected readonly codec = $inject(ActorCodec);
  public override async execute(request: ActorRequest): Promise<unknown> {
    const identity = this.codec.identity(
      this.alepha.name,
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
    const reply: ActorReply = JSON.parse(result);
    if (reply.error) {
      const error = new AlephaError(reply.error.message);
      error.name = reply.error.name;
      throw error;
    }
    return this.codec.copy(reply.value);
  }
}
