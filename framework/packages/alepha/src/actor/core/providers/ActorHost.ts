import { AlephaError } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

import type { ActorRequest } from "../interfaces/ActorInterfaces.ts";
import { ActorCodec } from "./ActorCodec.ts";
import { ActorHostRuntime } from "./ActorHostRuntime.ts";
import { ActorRegistry } from "./ActorRegistry.ts";
export interface ActorStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: string): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  deleteAll(): Promise<void>;
}
/**
 * One instance's serialized protocol KV snapshots on SQLite-backed storage.
 * Storage and host identity never enter the shared application's state.
 *
 * An expiring snapshot arms the instance's alarm at `expiresAt` plus
 * `alarmGraceMs`, and only when `expiresAt` changes: an alarm write is billed
 * as a row written, and a counter's expiry changes once per window, not once
 * per call. `alarm()` deletes the storage of an expired snapshot.
 */
export class ActorHost {
  protected readonly alarmGraceMs = 1000;
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
      if (updated !== envelope) {
        await this.storage.put("actor", JSON.stringify(updated));
        if (
          updated.expiresAt !== undefined &&
          updated.expiresAt !== this.expiry(raw)
        )
          await this.storage.setAlarm(updated.expiresAt + this.alarmGraceMs);
      }
      return codec.copy(updated.state);
    });
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  /**
   * The Durable Object alarm, serialized with every call. It has no request,
   * so no declaration: it reads `version` and `expiresAt` from the raw
   * envelope, never decoding state. Expired, the storage goes; still live
   * (the state moved on since the alarm was armed), it re-arms.
   */
  public alarm(): Promise<void> {
    const operation = this.tail.then(() => this.reclaim());
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  protected async reclaim(): Promise<void> {
    const expiresAt = this.expiry(await this.storage.get<string>("actor"));
    if (expiresAt === undefined) return;
    const now = ActorHostRuntime.resolve(this.env)
      .inject(DateTimeProvider)
      .nowMillis();
    if (expiresAt <= now) {
      await this.storage.deleteAlarm();
      await this.storage.deleteAll();
    } else await this.storage.setAlarm(expiresAt + this.alarmGraceMs);
  }

  /**
   * `expiresAt` of a raw v2 envelope, or undefined for anything else.
   */
  protected expiry(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    try {
      const envelope = JSON.parse(raw);
      return envelope?.version === 2 && Number.isSafeInteger(envelope.expiresAt)
        ? envelope.expiresAt
        : undefined;
    } catch {
      return undefined;
    }
  }
}
