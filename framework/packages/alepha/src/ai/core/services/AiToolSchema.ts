import { AiConfigError } from "../errors/AiConfigError.ts";

/**
 * Checks tool names against what every AI vendor accepts.
 *
 * The input schema of a tool is built by `ActionToolSchema` (`alepha`),
 * shared with `alepha/mcp`; the name rule is the vendors' own and stays here,
 * since MCP accepts longer names and dots.
 */
export class AiToolSchema {
  /**
   * The tool name pattern Anthropic, OpenAI and Workers AI all accept.
   */
  public readonly namePattern = /^[a-zA-Z0-9_-]{1,64}$/;

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
