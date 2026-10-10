import { AlephaError } from "alepha";

import type { ActorRequest } from "../interfaces/ActorInterfaces.ts";
import { ActorCodec } from "./ActorCodec.ts";
import { ActorHostRuntime } from "./ActorHostRuntime.ts";
import { ActorRegistry } from "./ActorRegistry.ts";
export interface ActorStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: string): Promise<void>;
}
/**
 * One instance's serialized protocol-v1 KV snapshots on SQLite-backed storage.
 * Storage and host identity never enter the shared application's state.
 */
export class ActorHost {
  protected tail: Promise<void> = Promise.resolve();
  protected readonly storage: ActorStorage;
  protected readonly env: Record<string, unknown>;
  protected readonly id: { toString(): string };
  constructor(
    storage: ActorStorage,
    env: Record<string, unknown>,
    id: { toString(): string },
  ) {
    this.storage = storage;
    this.env = env;
    this.id = id;
  }
  public async execute(
    identity: string,
    request: ActorRequest,
  ): Promise<unknown> {
    const app = ActorHostRuntime.resolve(this.env);
    const codec = app.inject(ActorCodec);
    if (
      typeof request.name !== "string" ||
      (request.key !== undefined &&
        (typeof request.key !== "string" || !request.key)) ||
      (request.method !== undefined && typeof request.method !== "string") ||
      !Array.isArray(request.args)
    )
      return Promise.reject(new AlephaError("Invalid actor dispatch"));
    const namespace = app.inject(ActorHostRuntime).namespace("ALEPHA_ACTOR");
    const expected = codec.identity(
      String(app.env.ALEPHA_ACTOR_NAMESPACE ?? ""),
      request.name,
      request.key,
    );
    if (
      expected !== identity ||
      namespace.idFromName(identity).toString() !== this.id.toString()
    )
      return Promise.reject(new AlephaError("Actor host identity mismatch"));
    const args = codec.copy(request.args);
    const declaration = app.inject(ActorRegistry).get(request.name);
    if (
      request.method !== undefined &&
      !Object.hasOwn(declaration.methods, request.method)
    )
      return Promise.reject(new AlephaError("Unknown actor method"));
    const operation = this.tail.then(async () => {
      const raw = await this.storage.get<string>("actor");
      let envelope =
        raw === undefined
          ? codec.initial(declaration)
          : codec.decode(raw, declaration);
      if (raw === undefined)
        await this.storage.put("actor", JSON.stringify(envelope));
      if (request.method !== undefined) {
        envelope = codec.transition(
          declaration,
          envelope,
          request.method,
          args,
        );
        await this.storage.put("actor", JSON.stringify(envelope));
      }
      return codec.copy(envelope.state);
    });
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
