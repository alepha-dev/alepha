import { $hook, $inject } from "alepha";
import {
  type AiChatRequest,
  AiConfigError,
  type AiEvent,
  AiHttpErrors,
  AiProvider,
  AiToolsUnsupportedError,
  ChatCompletionFormat,
} from "alepha/ai";
import { $logger } from "alepha/logger";

import { WorkersAiBinding as WorkersAiBindingDeclaration } from "../services/WorkersAiBinding.ts";

/**
 * AI provider on the Workers AI binding (`env.AI.run`): no API key, no
 * HTTP, the model runs where the Worker runs.
 *
 * - Streams with `stream: true`, read by `ChatCompletionFormat`: current
 *   models stream Chat Completions chunks, older ones `{ response }`.
 * - Function calling on the models whose catalog entry says
 *   `function_calling`. Offering tools to any other model throws
 *   `AiToolsUnsupportedError`, so the app knows to pick another model or
 *   register `AlephaAiAnthropic` instead. The catalog is read once per model,
 *   through the binding's own `models()`.
 * - The binding is checked at start: a missing one fails with a named
 *   `AiConfigError`, as the R2 provider does. This provider only exists on
 *   Workers (see `AlephaAiCloudflare`).
 *
 * **Environment:** `AI_MODEL` (a Workers AI id such as
 * `@cf/meta/llama-4-scout-17b-16e-instruct`), `AI_BINDING` (default `AI`),
 * `AI_GATEWAY_ID` (optional).
 */
export class WorkersAiProvider extends AiProvider {
  public readonly name = "workers-ai";

  protected readonly log = $logger();
  protected readonly format = $inject(ChatCompletionFormat);
  protected readonly errors = $inject(AiHttpErrors);
  protected readonly declaration = $inject(WorkersAiBindingDeclaration);

  /**
   * Whether each model id can call tools, from the catalog, read once.
   */
  protected readonly functionCalling = new Map<string, boolean>();

  protected readonly onStart = $hook({
    on: "start",
    handler: () => {
      this.binding();
      this.assertModelConfigured();
      this.log.info(
        `Workers AI provider ready (binding: ${this.bindingName}, model: ${this.env.AI_MODEL ?? "per request"})`,
      );
    },
  });

  /**
   * The binding name, `AI` unless `AI_BINDING` says otherwise.
   */
  public get bindingName(): string {
    return this.declaration.bindingName;
  }

  /**
   * The inputs sent to `env.AI.run()`. Public so a spec can assert them.
   */
  public toInputs(request: AiChatRequest): Record<string, unknown> {
    const inputs: Record<string, unknown> = {
      messages: this.format.toMessages(request),
      stream: true,
    };
    if (request.maxTokens) {
      inputs.max_tokens = request.maxTokens;
    }
    if (request.tools?.length) {
      inputs.tools = this.format.toTools(request.tools);
    }
    return inputs;
  }

  public async *chat(request: AiChatRequest): AsyncIterable<AiEvent> {
    const signal = this.signalOf(request);
    const model = this.resolveModel(request);
    const ai = this.binding();

    if (request.tools?.length && !(await this.canCallTools(ai, model))) {
      throw new AiToolsUnsupportedError(
        { provider: this.name },
        {
          message: `${this.name}: ${model} does not support function calling. Pick a Workers AI model with function calling, or register AlephaAiAnthropic for this app.`,
        },
      );
    }

    const options: Record<string, unknown> = { signal };
    if (this.declaration.gatewayId) {
      options.gateway = { id: this.declaration.gatewayId };
    }

    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await ai.run(model, this.toInputs(request), options);
    } catch (error) {
      signal.throwIfAborted();
      throw this.toError(error);
    }

    yield* this.format.read(this.name, stream, signal);
  }

  /**
   * The binding from the Worker's env.
   *
   * @throws AiConfigError when it is missing.
   */
  protected binding(): WorkersAiBindingApi {
    const env = this.alepha.get("cloudflare.env") as
      | Record<string, unknown>
      | undefined;
    const binding = env?.[this.bindingName] as WorkersAiBindingApi | undefined;
    if (!binding || typeof binding.run !== "function") {
      throw new AiConfigError(
        { provider: this.name },
        {
          message: `Workers AI binding '${this.bindingName}' not found in the Cloudflare Workers environment: declare it in wrangler ("ai": { "binding": "${this.bindingName}" }), which the Alepha Cloudflare build does when AlephaAiCloudflare is registered.`,
        },
      );
    }
    return binding;
  }

  /**
   * Whether `model` can call tools, per the catalog. A model the catalog
   * does not list, or a catalog that cannot be read, is given the benefit of
   * the doubt: the call then fails or succeeds on its own terms.
   */
  protected async canCallTools(
    ai: WorkersAiBindingApi,
    model: string,
  ): Promise<boolean> {
    const known = this.functionCalling.get(model);
    if (known !== undefined) {
      return known;
    }
    let answer = true;
    try {
      const found = (await ai.models?.({ search: model })) ?? [];
      const entry = found.find((m) => m.name === model);
      if (entry) {
        answer = entry.properties.some(
          (p) => p.property_id === "function_calling" && p.value === "true",
        );
      }
    } catch (error) {
      this.log.warn(`Workers AI catalog unreadable for ${model}`, error);
    }
    this.functionCalling.set(model, answer);
    return answer;
  }

  protected toError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    // The binding throws `InferenceUpstreamError` / `AiError` with the REST
    // API's code in the message ("3040: Capacity temporarily exceeded").
    const status = /\b3040\b|capacity/i.test(message)
      ? 503
      : /\b3036\b|rate limit|too many/i.test(message)
        ? 429
        : /\b10000\b|authentication|unauthori[sz]ed/i.test(message)
          ? 401
          : 400;
    return this.errors.fromStatus(this.name, status, message);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The slice of the Workers AI binding this provider calls.
 */
export interface WorkersAiBindingApi {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<ReadableStream<Uint8Array>>;
  models?(params?: { search?: string }): Promise<
    Array<{
      name: string;
      properties: Array<{ property_id: string; value: string }>;
    }>
  >;
}
