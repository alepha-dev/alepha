import { type Alepha, AlephaError, z, type ZObject } from "alepha";

import {
  McpForbiddenError,
  McpInputRequiredSignal,
  McpMissingRequiredClientCapabilityError,
} from "../errors/McpError.ts";
import type {
  McpElicitFormRequest,
  McpElicitResult,
  McpElicitUrlRequest,
} from "../interfaces/McpTypes.ts";

export interface McpElicitationSessionOptions {
  /**
   * Whether the request is modern: only a modern request can be answered
   * with an `InputRequiredResult`.
   */
  modern: boolean;
  /**
   * The client's `clientCapabilities` (modern only).
   */
  capabilities?: Record<string, unknown>;
  /**
   * Answers available to this run: the sealed ones, then this retry's
   * `inputResponses` for the keys the previous round asked.
   */
  answers: Record<string, unknown>;
  /**
   * Stable per request, to derive a URL elicitation's id.
   */
  requestDigest: string;
}

/**
 * One request's elicitation state, from the first pass to the last retry
 * (MRTR, spec 2026-07-28).
 *
 * The handler is replayed from the top on every retry, so an `elicit` is
 * identified by its position in the run: the n-th call is keyed `e<n>`. An
 * answer comes either from the sealed `requestState` (answered in an earlier
 * round) or from this retry's `inputResponses`; the first call with neither
 * throws {@link McpInputRequiredSignal}, which the provider turns into an
 * `InputRequiredResult`.
 *
 * Created by `McpServerProvider` for `tools/call`, `resources/read` and
 * `prompts/get` only; it is not a service.
 */
export class McpElicitationSession {
  /**
   * Answers consumed by this run, keyed `e<n>`: what the next round's sealed
   * state carries forward.
   */
  public readonly resolved: Record<string, McpElicitResult> = {};

  protected index = 0;

  /**
   * JSON Schemas already checked and converted, so a handler eliciting the
   * same schema on every round converts it once per process.
   */
  protected static readonly checked = new WeakMap<
    ZObject,
    Record<string, unknown>
  >();

  protected readonly alepha: Alepha;

  protected readonly options: McpElicitationSessionOptions;

  constructor(alepha: Alepha, options: McpElicitationSessionOptions) {
    this.alepha = alepha;
    this.options = options;
  }

  /**
   * The `context.elicit` handed to handlers.
   */
  public readonly elicit = (async (
    request: McpElicitFormRequest | McpElicitUrlRequest,
  ): Promise<McpElicitResult<any>> => {
    const key = `e${this.index++}`;
    const mode = "url" in request ? "url" : "form";
    // Checked before anything else, so a bad schema fails on the first pass
    // whatever the client declared.
    const requestedSchema =
      mode === "form"
        ? this.formSchema((request as McpElicitFormRequest).schema)
        : undefined;

    if (!this.options.modern || !this.declares(mode)) {
      if (request.required) {
        throw this.options.modern
          ? new McpMissingRequiredClientCapabilityError({
              rpcData: {
                requiredCapabilities: { elicitation: { [mode]: {} } },
              },
            })
          : new McpForbiddenError(
              `This request needs ${mode} elicitation, which a client on a protocol revision before 2026-07-28 cannot provide`,
            );
      }
      return { action: "unavailable" };
    }

    const answer = this.accept(
      mode,
      this.options.answers[key],
      mode === "form" ? (request as McpElicitFormRequest).schema : undefined,
    );
    if (answer) {
      this.resolved[key] = answer;
      return answer;
    }

    throw new McpInputRequiredSignal({
      key,
      inputRequest: {
        method: "elicitation/create",
        params:
          mode === "form"
            ? { mode, message: request.message, requestedSchema }
            : {
                mode,
                message: request.message,
                url: (request as McpElicitUrlRequest).url,
                elicitationId: `${this.options.requestDigest.slice(0, 16)}-${key}`,
              },
      },
    });
  }) as (
    request: McpElicitFormRequest | McpElicitUrlRequest,
  ) => Promise<McpElicitResult<any>>;

  /**
   * Whether the client declared this elicitation mode. An `elicitation`
   * object naming neither mode means form only (the 2025-06-18 shape, kept by
   * 2025-11-25 for compatibility).
   */
  protected declares(mode: "form" | "url"): boolean {
    const raw = this.options.capabilities?.elicitation;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return false;
    }
    const declared = raw as Record<string, unknown>;
    if (!("form" in declared) && !("url" in declared)) {
      return mode === "form";
    }
    return mode in declared;
  }

  /**
   * A client's answer as `elicit` resolves it, or `undefined` when there is
   * none or it is unusable (an unknown action, form content the schema
   * refuses): the question is then asked again rather than failed.
   */
  protected accept(
    mode: "form" | "url",
    raw: unknown,
    schema: ZObject | undefined,
  ): McpElicitResult | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    const answer = raw as { action?: unknown; content?: unknown };
    if (answer.action === "decline" || answer.action === "cancel") {
      return { action: answer.action };
    }
    if (answer.action !== "accept") {
      return undefined;
    }
    if (mode === "url" || !schema) {
      return { action: "accept", content: undefined as never };
    }
    try {
      const content = this.alepha.codec.decode(
        schema,
        answer.content ?? {},
      ) as Record<string, unknown>;
      return { action: "accept", content };
    } catch {
      return undefined;
    }
  }

  /**
   * The `requestedSchema` sent for a form, after checking that the client can
   * render it: a flat object of strings, numbers, integers, booleans and
   * enums.
   */
  protected formSchema(schema: ZObject): Record<string, unknown> {
    const cached = McpElicitationSession.checked.get(schema);
    if (cached) {
      return cached;
    }
    let json: Record<string, unknown>;
    try {
      json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
    } catch (error) {
      throw new AlephaError(
        "An elicitation schema must be expressible as JSON Schema",
        { cause: error },
      );
    }
    if (json.type !== "object") {
      throw new AlephaError("An elicitation schema must be a z.object()");
    }
    const properties = (json.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const [name, property] of Object.entries(properties)) {
      const type = property.type;
      const primitive =
        type === "string" ||
        type === "number" ||
        type === "integer" ||
        type === "boolean";
      if (!primitive || "anyOf" in property || "oneOf" in property) {
        throw new AlephaError(
          `Elicitation field '${name}' must be a z.text(), z.number(), z.integer(), z.boolean() or z.enum(): a client is only required to render those`,
        );
      }
    }
    const { $schema: _, ...requested } = json;
    McpElicitationSession.checked.set(schema, requested);
    return requested;
  }
}
