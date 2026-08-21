import {
  $inject,
  type Async,
  createPrimitive,
  KIND,
  Primitive,
  SchemaValidationError,
  type ZObject,
  type ZType,
  z,
} from "alepha";

import { McpToolOutputError } from "../errors/McpError.ts";
import type {
  McpContext,
  McpIcon,
  McpJsonSchema,
  McpToolAnnotations,
  McpToolDescriptor,
  ToolHandlerArgs,
  ToolHandlerResult,
  ToolPrimitiveSchema,
} from "../interfaces/McpTypes.ts";
import { McpServerProvider } from "../providers/McpServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Creates an MCP tool primitive for defining callable functions.
 *
 * Tools are the primary way for LLMs to interact with external systems through MCP.
 * Each tool has a name, description, typed parameters, and a handler function.
 *
 * **Key Features**
 * - Full TypeScript inference for parameters and results
 * - Automatic schema validation using Zod
 * - JSON Schema generation for MCP protocol
 * - Integration with MCP server provider
 *
 * @example
 * ```ts
 * class CalculatorTools {
 *   add = $tool({
 *     description: "Add two numbers together",
 *     schema: {
 *       params: z.object({
 *         a: z.number(),
 *         b: z.number(),
 *       }),
 *       result: z.number(),
 *     },
 *     handler: async ({ params }) => {
 *       return params.a + params.b;
 *     },
 *   });
 *
 *   greet = $tool({
 *     description: "Generate a greeting message",
 *     schema: {
 *       params: z.object({
 *         name: z.text(),
 *       }),
 *       result: z.text(),
 *     },
 *     handler: async ({ params }) => {
 *       return `Hello, ${params.name}!`;
 *     },
 *   });
 * }
 * ```
 */
export const $tool = <T extends ToolPrimitiveSchema>(
  options: ToolPrimitiveOptions<T>,
): ToolPrimitive<T> => {
  return createPrimitive(ToolPrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ToolPrimitiveOptions<T extends ToolPrimitiveSchema> {
  /**
   * The name of the tool.
   *
   * If not provided, defaults to the property key where the tool is declared.
   * Names should be descriptive and use kebab-case or snake_case.
   *
   * @example "calculate-sum"
   * @example "get_weather"
   */
  name?: string;

  /**
   * Human-friendly display title (spec 2025-11-25). Distinct from `name`,
   * which remains the programmatic identifier. Clients use `title` in
   * tool palettes / picker UIs.
   *
   * @example "Search Lore"
   */
  title?: string;

  /**
   * A human-readable description of what the tool does.
   *
   * This description is sent to the LLM to help it understand
   * when and how to use the tool. Be clear and specific.
   *
   * @example "Calculate the sum of two numbers"
   * @example "Retrieve current weather data for a given location"
   */
  description: string;

  /**
   * Behavior hints (spec 2025-03-26+). Clients use these to gate UI prompts
   * (e.g. require confirmation before a tool with `destructiveHint: true`).
   * None are guarantees — they are heuristics for the client, not the model.
   */
  annotations?: McpToolAnnotations;

  /**
   * Icons surfaced in client tool palettes / picker UIs (spec 2025-11-25).
   */
  icons?: McpIcon[];

  /**
   * Arbitrary metadata passed through to clients on the descriptor
   * (spec 2025-06-18+). For anything the protocol has no field for.
   */
  _meta?: Record<string, unknown>;

  /**
   * Zod schema defining the tool's parameters and result type.
   *
   * - **params**: ZObject schema for input parameters (optional)
   * - **result**: ZType for the return value (optional)
   *
   * Schemas provide:
   * - Type inference for handler function
   * - Runtime validation of inputs
   * - JSON Schema generation for MCP protocol
   */
  schema?: T;

  /**
   * The handler function that executes when the tool is called.
   *
   * Receives validated parameters and returns the result.
   * Errors thrown here are caught and returned as MCP errors.
   *
   * @param args - Object containing validated params
   * @returns The tool result (can be async)
   */
  handler: (args: ToolHandlerArgs<T>) => Async<ToolHandlerResult<T>>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ToolPrimitive<T extends ToolPrimitiveSchema> extends Primitive<
  ToolPrimitiveOptions<T>
> {
  protected readonly mcpServer = $inject(McpServerProvider);

  /**
   * Returns the name of the tool.
   */
  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }

  /**
   * Returns the description of the tool.
   */
  public get description(): string {
    return this.options.description;
  }

  /**
   * Whether the tool declared a result schema. When true, `tools/call`
   * responses include `structuredContent` populated with the validated
   * result (spec 2025-06-18).
   */
  public hasOutputSchema(): boolean {
    return !!this.options.schema?.result;
  }

  protected onInit(): void {
    this.mcpServer.registerTool(this);
  }

  /**
   * Execute the tool with the given parameters.
   *
   * @param params - Raw parameters to validate and pass to the handler
   * @param context - Optional context from the transport layer
   * @returns The tool result
   */
  public async execute(
    params: unknown,
    context?: McpContext,
  ): Promise<ToolHandlerResult<T>> {
    let validatedParams: any = params ?? {};

    // Input validation. A failure here IS the caller's fault, so the raw
    // SchemaValidationError propagates and the server reports it as a
    // self-correctable tool execution error (SEP-1303).
    if (this.options.schema?.params) {
      validatedParams = this.alepha.codec.decode(
        this.options.schema.params,
        validatedParams,
      );
    }

    const result = await this.options.handler({
      params: validatedParams,
      context,
    });

    // Output validation. A failure here is a bug in THIS tool, and must not
    // reach the caller wearing the same error type as an input failure — see
    // McpToolOutputError.
    if (this.options.schema?.result && result !== undefined) {
      try {
        return this.alepha.codec.encode(
          this.options.schema.result,
          result,
        ) as ToolHandlerResult<T>;
      } catch (error) {
        if (error instanceof SchemaValidationError) {
          throw new McpToolOutputError(
            this.name,
            `at ${error.value?.path || "/"}: ${error.value?.message || error.message}`,
          );
        }
        throw error;
      }
    }

    return result as ToolHandlerResult<T>;
  }

  /**
   * Convert the tool to an MCP tool descriptor for protocol messages.
   *
   * Emits the spec 2025-11-25 surface: `title`, `annotations`, `icons`,
   * and (when `schema.result` is defined) `outputSchema` so the server
   * can populate `structuredContent` on call results.
   */
  public toDescriptor(): McpToolDescriptor {
    const inputSchema: McpJsonSchema = this.options.schema?.params
      ? this.schemaToJsonSchema(this.options.schema.params)
      : { type: "object", properties: {}, required: [] };

    const descriptor: McpToolDescriptor = {
      name: this.name,
      description: this.description,
      inputSchema,
    };

    if (this.options.title) descriptor.title = this.options.title;
    if (this.options.annotations)
      descriptor.annotations = this.options.annotations;
    if (this.options.icons && this.options.icons.length > 0) {
      descriptor.icons = this.options.icons;
    }
    if (this.options._meta) descriptor._meta = this.options._meta;

    // Output schema is emitted when the tool declares `schema.result`,
    // unlocking structured content on tools/call responses.
    if (this.options.schema?.result) {
      const out = this.propertyToJsonSchema(this.options.schema.result);
      // The result schema may be a primitive — wrap so the descriptor
      // value is always a JSON Schema object with `type`.
      descriptor.outputSchema = (
        typeof out === "object" && out !== null && "type" in out
          ? out
          : { type: "object", properties: {}, required: [] }
      ) as McpJsonSchema;
    }

    return descriptor;
  }

  /**
   * Convert a Zod schema to JSON Schema format.
   *
   * Emits the 2020-12 dialect annotation at the root (spec 2025-11-25 /
   * SEP-1613 — JSON Schema 2020-12 is the default dialect for MCP).
   * The JSON Schema shapes Alepha emits today are already 2020-12-compatible;
   * this is just the dialect declaration.
   */
  protected schemaToJsonSchema(
    schema: ZObject,
    options?: { root?: boolean },
  ): McpJsonSchema {
    let json: any;
    try {
      json = z.toJSONSchema(schema as any);
    } catch {
      json = { type: "object", properties: {}, required: [] };
    }

    // Annotate the 2020-12 dialect on the root schema only (avoid noise on
    // nested sub-schemas where MCP doesn't expect $schema).
    if (options?.root === false) {
      json.$schema = undefined;
    } else {
      json.$schema = "https://json-schema.org/draft/2020-12/schema";
    }

    return json as McpJsonSchema;
  }

  /**
   * Convert a single property schema to JSON Schema format (zod-native).
   */
  protected propertyToJsonSchema(schema: ZType): Record<string, unknown> {
    try {
      const json: any = z.toJSONSchema(schema as any);
      json.$schema = undefined;
      return json;
    } catch {
      return { type: "string" };
    }
  }
}

$tool[KIND] = ToolPrimitive;
