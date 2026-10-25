import { $inject, AlephaError, SchemaValidator, type ZType } from "alepha";

import type {
  ActorDeclaration,
  ActorEnvelope,
} from "../interfaces/ActorInterfaces.ts";

/**
 * Lossless JSON snapshots and protocol-v1 validation shared by actor providers.
 */
export class ActorCodec {
  protected readonly validator = $inject(SchemaValidator);

  public copy<T>(value: T): T {
    this.inspect(value, new Set());
    return JSON.parse(JSON.stringify(value));
  }

  protected inspect(value: unknown, ancestors: Set<object>): void {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return;
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      !Object.is(value, -0)
    )
      return;
    if (typeof value !== "object" || value === null)
      throw new AlephaError("Actor data must be lossless JSON");
    if (ancestors.has(value))
      throw new AlephaError("Actor data cannot contain cycles");
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (
      array
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    )
      throw new AlephaError("Actor data must contain only plain objects");
    if (Object.getOwnPropertySymbols(value).length)
      throw new AlephaError("Actor data cannot contain symbol keys");
    ancestors.add(value);
    const keys = Object.getOwnPropertyNames(value);
    if (array && (keys.length !== value.length + 1 || !keys.includes("length")))
      throw new AlephaError(
        "Actor arrays must be dense without extra properties",
      );
    for (const key of keys) {
      if (array && key === "length") continue;
      if (
        array &&
        (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)
      )
        throw new AlephaError(
          "Actor arrays must be dense without extra properties",
        );
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
        throw new AlephaError(
          "Actor data cannot contain accessors or hidden properties",
        );
      this.inspect(descriptor.value, ancestors);
    }
    ancestors.delete(value);
  }

  public freeze<T>(value: T): T {
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) this.freeze(item);
      Object.freeze(value);
    }
    return value;
  }

  public validate(schema: ZType, value: unknown, stored = false): unknown {
    const detached = this.copy(value);
    let parsed: unknown;
    try {
      parsed = this.validator.validate(schema, detached);
    } catch (error) {
      throw new AlephaError(
        "Invalid actor state or unsupported asynchronous schema",
        { cause: error },
      );
    }
    const result = this.copy(parsed);
    if (stored && this.canonical(value) !== this.canonical(result))
      throw new AlephaError(
        "Stored actor state is incompatible with its schema",
      );
    return result;
  }

  protected canonical(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.canonical(item)).join(",")}]`;
    if (value !== null && typeof value === "object")
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.canonical((value as Record<string, unknown>)[key])}`,
        )
        .join(",")}}`;
    return JSON.stringify(value);
  }

  /**
   * The envelope a call starts from: the stored one, or the initial envelope
   * when nothing is stored or the stored state expired at or before `now`.
   * Logically missing is not physically absent: callers that compare-and-set
   * keep the raw bytes they read.
   */
  public current(
    raw: string | undefined,
    declaration: ActorDeclaration,
    now: number,
  ): ActorEnvelope {
    if (raw === undefined) return this.initial(declaration);
    return this.decode(raw, declaration, now) ?? this.initial(declaration);
  }

  /**
   * Decode a stored envelope, v1 or v2. Returns undefined for a v2 envelope
   * whose `expiresAt` is at or before `now`: expired state reads as missing and
   * is not validated against the schema.
   */
  public decode(
    raw: string,
    declaration: ActorDeclaration,
    now: number,
  ): ActorEnvelope | undefined {
    let envelope: ActorEnvelope;
    try {
      envelope = JSON.parse(raw);
    } catch (error) {
      throw new AlephaError("Corrupt actor envelope", { cause: error });
    }
    const keys =
      envelope && typeof envelope === "object"
        ? Object.keys(envelope).sort().join(",")
        : "";
    if (
      !(
        (envelope?.version === 1 && keys === "revision,state,version") ||
        (envelope?.version === 2 &&
          keys === "expiresAt,revision,state,version" &&
          Number.isSafeInteger(envelope.expiresAt))
      ) ||
      !Number.isSafeInteger(envelope.revision) ||
      envelope.revision < 0
    )
      throw new AlephaError("Invalid actor protocol envelope");
    if (envelope.version === 2 && envelope.expiresAt! <= now) return undefined;
    this.validate(declaration.atom.schema, envelope.state, true);
    return envelope;
  }

  public initial(declaration: ActorDeclaration): ActorEnvelope {
    return {
      version: 1,
      revision: 0,
      state: this.validate(
        declaration.atom.schema,
        declaration.atom.options.default,
      ),
    };
  }

  /**
   * Apply one reducer to an envelope. A result canonically equal to the
   * current state returns `envelope` itself, revision untouched: callers
   * compare by identity and commit nothing for a no-op.
   */
  public transition(
    declaration: ActorDeclaration,
    envelope: ActorEnvelope,
    method: string,
    args: unknown[],
  ): ActorEnvelope {
    if (!Object.hasOwn(declaration.methods, method))
      throw new AlephaError(`Unknown actor method '${method}'`);
    if (envelope.revision === Number.MAX_SAFE_INTEGER)
      throw new AlephaError("Actor revision overflow");
    const next = declaration.methods[method](
      this.freeze(this.copy(envelope.state)),
      ...this.freeze(this.copy(args)),
    );
    const state = this.validate(declaration.atom.schema, next);
    if (this.canonical(state) === this.canonical(envelope.state))
      return envelope;
    return this.envelope(declaration, envelope.revision + 1, state);
  }

  /**
   * Stamp a validated state: v2 with `expiresAt` when the declaration's expiry
   * returns a number for it, v1 byte for byte otherwise. A return that is
   * neither undefined nor a safe integer fails the transition.
   */
  protected envelope(
    declaration: ActorDeclaration,
    revision: number,
    state: unknown,
  ): ActorEnvelope {
    const expiresAt = declaration.expiresAt?.(this.freeze(this.copy(state)));
    if (expiresAt === undefined) return { version: 1, revision, state };
    if (!Number.isSafeInteger(expiresAt))
      throw new AlephaError(
        "Actor expiresAt must return a safe integer or undefined",
      );
    return { version: 2, revision, state, expiresAt };
  }

  public identity(namespace: string, name: string, key?: string): string {
    return JSON.stringify([
      "alepha.actor",
      1,
      namespace,
      name,
      key === undefined ? ["default"] : ["key", key],
    ]);
  }
}
