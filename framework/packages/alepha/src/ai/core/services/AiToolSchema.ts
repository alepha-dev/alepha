import { AlephaError, type ZType, z } from "alepha";

import { AiConfigError } from "../errors/AiConfigError.ts";

/**
 * Turns Zod schemas into the JSON Schema a vendor reads for a tool's input,
 * and checks tool names against what every vendor accepts.
 *
 * Input mode (`io: "input"`), as `alepha/mcp` does: the model is told what to
 * SEND, so a field with a `.default()` is optional and a `.transform()` is
 * described by its input type.
 */
export class AiToolSchema {
  /**
   * The tool name pattern Anthropic, OpenAI and Workers AI all accept.
   */
  public readonly namePattern = /^[a-zA-Z0-9_-]{1,64}$/;

  /**
   * JSON Schema of `schema`, in input mode, without the `$schema` dialect
   * key (vendors reject or ignore it).
   */
  public toJsonSchema(schema: ZType): Record<string, unknown> {
    let json: Record<string, unknown>;
    try {
      json = z.toJSONSchema(schema as any, { io: "input" }) as Record<
        string,
        unknown
      >;
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
   * Throws when `name` is not a valid tool name.
   */
  public assertName(name: string): void {
    if (!this.namePattern.test(name)) {
      throw new AiConfigError(
        {},
        {
          message: `Invalid AI tool name '${name}': a tool name must match ${this.namePattern} (letters, digits, '_' and '-', at most 64).`,
        },
      );
    }
  }
}
