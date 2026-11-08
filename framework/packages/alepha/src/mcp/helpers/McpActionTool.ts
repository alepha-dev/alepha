import type { ActionMcpOptions, ActionPrimitive } from "alepha/server";

import type {
  McpJsonSchema,
  McpToolAnnotations,
  McpToolDescriptor,
} from "../interfaces/McpTypes.ts";

/**
 * An `$action({ mcp })` as the MCP server lists and calls it.
 *
 * The descriptor is built once, from `ActionToolSchema.fromAction`, the same
 * converter `$ai` uses, so an outside agent and the in-app assistant see the
 * same input: `{ params, query, body }`. The call goes through `action.run()`,
 * so the action's own middlewares, timeout and typed errors decide.
 */
export class McpActionTool {
  public readonly action: ActionPrimitive<any>;
  public readonly name: string;
  public readonly descriptor: McpToolDescriptor;

  constructor(
    action: ActionPrimitive<any>,
    definition: {
      description: string;
      inputSchema: Record<string, unknown>;
      parts: Array<"params" | "query" | "body">;
    },
  ) {
    this.action = action;
    const options = this.options();
    this.name = options.name ?? action.name;
    this.parts = definition.parts;
    this.descriptor = {
      name: this.name,
      description: definition.description,
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        ...definition.inputSchema,
      } as McpJsonSchema,
    };
    if (options.title) {
      this.descriptor.title = options.title;
    }
    const annotations = this.annotations(options);
    if (Object.keys(annotations).length) {
      this.descriptor.annotations = annotations;
    }
    if (options.icons?.length) {
      this.descriptor.icons = options.icons;
    }
  }

  /**
   * The parts of a request the action declares: the only keys of the
   * arguments passed on to it.
   */
  public readonly parts: Array<"params" | "query" | "body">;

  /**
   * The permissions the action's `$secure` middlewares require, by name, so
   * the transport can answer a step-up challenge before dispatch, as it does
   * for a `$tool`.
   */
  public get requiredPermissions(): string[] {
    const names: string[] = [];
    for (const meta of this.action.handler.metadata) {
      if (meta.name !== "$secure") continue;
      const permissions = (meta.options as { permissions?: unknown[] })
        ?.permissions;
      for (const it of permissions ?? []) {
        const name =
          typeof it === "string"
            ? it
            : (it as { name?: unknown } | undefined)?.name;
        if (typeof name === "string" && !names.includes(name)) {
          names.push(name);
        }
      }
    }
    return names;
  }

  /**
   * Run the action with the call's arguments. No `user` option: `$secure`
   * reads the caller from the request the MCP call arrived on, as it does
   * for a `$tool`, and over stdio the action runs anonymous.
   */
  public async call(args: Record<string, unknown>): Promise<unknown> {
    const input: Record<string, unknown> = {};
    for (const part of this.parts) {
      if (args[part] !== undefined) {
        input[part] = args[part];
      }
    }
    return this.action.run(input as never);
  }

  protected options(): ActionMcpOptions {
    const mcp = this.action.options.mcp;
    return typeof mcp === "object" && mcp ? mcp : {};
  }

  /**
   * The hints a method implies, under the ones the action declares.
   */
  protected annotations(options: ActionMcpOptions): McpToolAnnotations {
    const defaults: McpToolAnnotations = {};
    if (this.action.method === "GET") {
      defaults.readOnlyHint = true;
    } else if (this.action.method === "DELETE") {
      defaults.destructiveHint = true;
    }
    return { ...defaults, ...options.annotations };
  }
}
