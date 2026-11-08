import { AlephaError } from "../errors/AlephaError.ts";
import { type ZType, z } from "../providers/ZodProvider.ts";

/**
 * Turns an `$action` into a tool definition: the name, the description and
 * the JSON Schema of the input a model or an MCP client sends.
 *
 * Both `$ai` and `alepha/mcp` build an action's tool through this, so the
 * assistant and an outside agent see the same shape: one object with a key
 * per part the action declares, `{ params, query, body }`, `query` optional
 * and nothing else accepted.
 *
 * Input mode (`io: "input"`): the caller is told what to SEND, so a field
 * with a `.default()` is optional and a `.transform()` is described by its
 * input type.
 *
 * It checks no name: each consumer has its own rule (the AI vendors accept
 * `^[a-zA-Z0-9_-]{1,64}$`, MCP accepts longer names and dots).
 *
 * It lives in `alepha` rather than `alepha/server`, beside the codecs: `$ai`
 * needs it at runtime, and `alepha/ai` must not import `alepha/server`, whose
 * Node barrel would reach every Worker bundle that reaches `alepha/ai`. It
 * reads an action by shape ({@link ActionToolSource}), so it needs no import
 * of `$action` either.
 */
export class ActionToolSchema {
  /**
   * The parts of a request an action may declare, in the order a tool's
   * input lists them.
   */
  public readonly parts = ["params", "query", "body"] as const;

  /**
   * JSON Schema of `schema`, in input mode, without the `$schema` dialect
   * key (vendors reject or ignore it).
   */
  public toJsonSchema(schema: ZType): Record<string, unknown> {
    let json: Record<string, unknown>;
    try {
      json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
    } catch (error) {
      throw new AlephaError(
        "A tool input schema cannot be expressed as JSON Schema",
        { cause: error },
      );
    }
    delete json.$schema;
    return json;
  }

  /**
   * The tool an action is offered as. Throws an `AlephaError` naming the
   * action when it has no description: it is how a model knows when to call
   * the tool.
   */
  public fromAction(action: ActionToolSource): ActionToolDefinition {
    const description = action.options.description;
    if (!description) {
      throw new AlephaError(
        `action '${action.name}' has no description, and a tool needs one: it is how the model knows when to call it.`,
      );
    }
    const parts = this.parts.filter((part) => action.schema?.[part]);
    const properties: Record<string, unknown> = {};
    for (const part of parts) {
      properties[part] = this.toJsonSchema(action.schema![part]!);
    }
    return {
      name: action.name,
      description,
      parts,
      inputSchema: {
        type: "object",
        properties,
        required: parts.filter((part) => part !== "query"),
        additionalProperties: false,
      },
    };
  }
}

/**
 * What {@link ActionToolSchema.fromAction} reads of an `$action`: its name,
 * its description and the schemas of its request parts.
 */
export interface ActionToolSource {
  name: string;
  options: { description?: string };
  schema?: { params?: ZType; query?: ZType; body?: ZType };
}

/**
 * What {@link ActionToolSchema.fromAction} builds.
 */
export interface ActionToolDefinition {
  /**
   * The action's name. Unchecked: each consumer applies its own pattern.
   */
  name: string;
  description: string;
  /**
   * The input's JSON Schema: an object with a key per declared part.
   */
  inputSchema: Record<string, unknown>;
  /**
   * The parts the action declares, the keys `inputSchema` may hold.
   */
  parts: Array<"params" | "query" | "body">;
}
