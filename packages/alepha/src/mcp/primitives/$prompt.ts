import {
  $inject,
  type Async,
  createPrimitive,
  type Infer,
  KIND,
  Primitive,
  type ZObject,
  z,
} from "alepha";
import type {
  McpContext,
  McpIcon,
  McpPromptArgument,
  McpPromptDescriptor,
  PromptHandlerArgs,
  PromptMessage,
} from "../interfaces/McpTypes.ts";
import { McpServerProvider } from "../providers/McpServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Creates an MCP prompt primitive for defining reusable prompt templates.
 *
 * Prompts allow you to define templated messages that can be filled in
 * with arguments at runtime. They're useful for creating consistent
 * interaction patterns.
 *
 * @example
 * ```ts
 * class Prompts {
 *   greeting = $prompt({
 *     description: "Generate a personalized greeting",
 *     args: z.object({
 *       name: z.text({ description: "Name of the person to greet" }),
 *       style: z.enum(["formal", "casual"]).optional(),
 *     }),
 *     handler: async ({ args }) => [
 *       {
 *         role: "user",
 *         content: args.style === "formal"
 *           ? `Please greet ${args.name} in a formal manner.`
 *           : `Say hi to ${args.name}!`,
 *       },
 *     ],
 *   });
 *
 *   codeReview = $prompt({
 *     description: "Request a code review",
 *     args: z.object({
 *       code: z.text({ description: "The code to review" }),
 *       language: z.text({ description: "Programming language" }),
 *     }),
 *     handler: async ({ args }) => [
 *       {
 *         role: "user",
 *         content: `Please review this ${args.language} code:\n\n${args.code}`,
 *       },
 *     ],
 *   });
 * }
 * ```
 */
export const $prompt = <T extends ZObject>(
  options: PromptPrimitiveOptions<T>,
): PromptPrimitive<T> => {
  return createPrimitive(PromptPrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface PromptPrimitiveOptions<T extends ZObject> {
  /**
   * The name of the prompt.
   *
   * If not provided, defaults to the property key where the prompt is declared.
   *
   * @example "greeting"
   * @example "code-review"
   */
  name?: string;

  /**
   * Human-friendly display title (spec 2025-11-25). Distinct from `name`,
   * which remains the programmatic identifier.
   */
  title?: string;

  /**
   * Description of what this prompt does.
   *
   * Helps users understand the purpose of the prompt.
   *
   * @example "Generate a personalized greeting message"
   */
  description?: string;

  /**
   * Optional icons surfaced in client UIs (spec 2025-11-25 / SEP-973).
   */
  icons?: McpIcon[];

  /**
   * Zod schema defining the prompt arguments.
   *
   * Each property in the schema becomes an argument that can be
   * filled in when the prompt is used.
   */
  args?: T;

  /**
   * Handler function that generates the prompt messages.
   *
   * Receives the validated arguments and returns an array of messages.
   *
   * @param args - Object containing validated arguments
   * @returns Array of prompt messages
   */
  handler: (args: PromptHandlerArgs<T>) => Async<PromptMessage[]>;
}

// ---------------------------------------------------------------------------------------------------------------------

export class PromptPrimitive<T extends ZObject> extends Primitive<
  PromptPrimitiveOptions<T>
> {
  protected readonly mcpServer = $inject(McpServerProvider);

  /**
   * Returns the name of the prompt.
   */
  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }

  /**
   * Returns the description of the prompt.
   */
  public get description(): string | undefined {
    return this.options.description;
  }

  protected onInit(): void {
    this.mcpServer.registerPrompt(this);
  }

  /**
   * Get the prompt messages with the given arguments.
   *
   * @param rawArgs - Raw arguments to validate and pass to the handler
   * @param context - Optional context from the transport layer
   * @returns Array of prompt messages
   */
  public async get(
    rawArgs: unknown,
    context?: McpContext,
  ): Promise<PromptMessage[]> {
    let args = (rawArgs ?? {}) as Infer<T>;

    if (this.options.args) {
      args = this.alepha.codec.decode(this.options.args, rawArgs ?? {});
    }

    return this.options.handler({ args, context });
  }

  /**
   * Convert the prompt to an MCP prompt descriptor for protocol messages.
   */
  public toDescriptor(): McpPromptDescriptor {
    const descriptor: McpPromptDescriptor = {
      name: this.name,
      description: this.description,
      arguments: this.options.args
        ? this.schemaToArguments(this.options.args)
        : [],
    };
    if (this.options.title) descriptor.title = this.options.title;
    if (this.options.icons && this.options.icons.length > 0) {
      descriptor.icons = this.options.icons;
    }
    return descriptor;
  }

  /**
   * Convert a Zod schema to an array of prompt arguments.
   */
  protected schemaToArguments(schema: ZObject): McpPromptArgument[] {
    const args: McpPromptArgument[] = [];

    for (const [name, propSchema] of Object.entries(z.schema.shape(schema))) {
      // The description lives on the inner schema; peel optional/nullable/default
      // wrappers so `z.number({ description }).optional()` still surfaces it.
      const prop = z.schema.unwrap(propSchema) as Record<string, unknown>;
      args.push({
        name,
        description: prop.description as string | undefined,
        required: !z.schema.isOptional(propSchema),
      });
    }

    return args;
  }
}

$prompt[KIND] = PromptPrimitive;
