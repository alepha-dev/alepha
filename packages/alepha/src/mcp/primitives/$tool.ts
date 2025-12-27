import {
  $inject,
  type Async,
  createPrimitive,
  KIND,
  Primitive,
  type TObject,
  type TSchema,
  t,
} from "alepha";
import type {
  McpContext,
  McpJsonSchema,
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
 * - Automatic schema validation using TypeBox
 * - JSON Schema generation for MCP protocol
 * - Integration with MCP server provider
 *
 * @example
 * ```ts
 * class CalculatorTools {
 *   add = $tool({
 *     description: "Add two numbers together",
 *     schema: {
 *       params: t.object({
 *         a: t.number(),
 *         b: t.number(),
 *       }),
 *       result: t.number(),
 *     },
 *     handler: async ({ params }) => {
 *       return params.a + params.b;
 *     },
 *   });
 *
 *   greet = $tool({
 *     description: "Generate a greeting message",
 *     schema: {
 *       params: t.object({
 *         name: t.text(),
 *       }),
 *       result: t.text(),
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
   * TypeBox schema defining the tool's parameters and result type.
   *
   * - **params**: TObject schema for input parameters (optional)
   * - **result**: TSchema for the return value (optional)
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

    // Validate params using alepha.codec if schema provided
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

    // Validate and encode result if schema provided
    if (this.options.schema?.result && result !== undefined) {
      return this.alepha.codec.encode(
        this.options.schema.result,
        result,
      ) as ToolHandlerResult<T>;
    }

    return result as ToolHandlerResult<T>;
  }

  /**
   * Convert the tool to an MCP tool descriptor for protocol messages.
   */
  public toDescriptor(): McpToolDescriptor {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.options.schema?.params
        ? this.schemaToJsonSchema(this.options.schema.params)
        : { type: "object", properties: {}, required: [] },
    };
  }

  /**
   * Convert a TypeBox schema to JSON Schema format.
   */
  protected schemaToJsonSchema(schema: TObject): McpJsonSchema {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      properties[key] = this.propertyToJsonSchema(propSchema as TSchema);

      // Check if property is required (not optional)
      if (!t.schema.isOptional(propSchema as TSchema)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required,
    };
  }

  /**
   * Convert a single property schema to JSON Schema format.
   */
  protected propertyToJsonSchema(schema: TSchema): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Check for description on all types
    if ("description" in schema) {
      result.description = schema.description;
    }

    if (t.schema.isString(schema)) {
      result.type = "string";
      if ("minLength" in schema) result.minLength = schema.minLength;
      if ("maxLength" in schema) result.maxLength = schema.maxLength;
      if ("pattern" in schema) result.pattern = schema.pattern;
      if ("enum" in schema) result.enum = schema.enum;
    } else if (t.schema.isNumber(schema)) {
      result.type = "number";
      if ("minimum" in schema) result.minimum = schema.minimum;
      if ("maximum" in schema) result.maximum = schema.maximum;
    } else if (t.schema.isInteger(schema)) {
      result.type = "integer";
      if ("minimum" in schema) result.minimum = schema.minimum;
      if ("maximum" in schema) result.maximum = schema.maximum;
    } else if (t.schema.isBoolean(schema)) {
      result.type = "boolean";
    } else if (t.schema.isArray(schema)) {
      result.type = "array";
      if ("items" in schema) {
        result.items = this.propertyToJsonSchema(schema.items as TSchema);
      }
    } else if (t.schema.isObject(schema)) {
      Object.assign(result, this.schemaToJsonSchema(schema));
    } else if (t.schema.isUnsafe(schema) || t.schema.isOptional(schema)) {
      // Handle Unsafe types (like t.enum) and optional wrappers by checking the underlying type property
      const schemaAny = schema as { type?: string; enum?: unknown[] };
      if (schemaAny.type === "string") {
        result.type = "string";
        if ("enum" in schema) result.enum = schema.enum;
        if ("pattern" in schema) result.pattern = schema.pattern;
      } else if (schemaAny.type === "number") {
        result.type = "number";
      } else if (schemaAny.type === "integer") {
        result.type = "integer";
      } else if (schemaAny.type === "boolean") {
        result.type = "boolean";
      } else if (schemaAny.type === "array") {
        result.type = "array";
      } else if (schemaAny.type === "object") {
        result.type = "object";
      } else {
        // Fallback
        result.type = "string";
      }
    } else {
      // Fallback for other types
      result.type = "string";
    }

    return result;
  }
}

$tool[KIND] = ToolPrimitive;
