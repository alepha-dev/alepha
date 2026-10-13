import { AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

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
    const expected = codec.identity(app.name, request.name, request.key);
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
      const envelope = codec.current(
        raw,
        declaration,
        app.inject(DateTimeProvider).nowMillis(),
      );
      // A read never writes: a missing key stays missing.
      if (request.method === undefined) return codec.copy(envelope.state);
      const updated = codec.transition(
        declaration,
        envelope,
        request.method,
        args,
      );
      // An unchanged state commits nothing, on a missing key too.
      if (updated !== envelope)
        await this.storage.put("actor", JSON.stringify(updated));
      return codec.copy(updated.state);
    });
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
