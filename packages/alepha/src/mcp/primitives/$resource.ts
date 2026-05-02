import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import type {
  McpContext,
  McpIcon,
  McpResourceDescriptor,
  ResourceContent,
  ResourceHandler,
} from "../interfaces/McpTypes.ts";
import { McpServerProvider } from "../providers/McpServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Creates an MCP resource primitive for exposing read-only data.
 *
 * Resources represent any kind of data that an LLM might want to read,
 * such as files, database records, API responses, or computed data.
 *
 * **Key Features**
 * - URI-based identification for resources
 * - Support for text and binary content
 * - MIME type specification
 * - Lazy loading via handler function
 *
 * @example
 * ```ts
 * class ProjectResources {
 *   readme = $resource({
 *     uri: "file:///readme",
 *     description: "Project README file",
 *     mimeType: "text/markdown",
 *     handler: async () => ({
 *       text: await fs.readFile("README.md", "utf-8"),
 *     }),
 *   });
 *
 *   config = $resource({
 *     uri: "config://app",
 *     name: "Application Configuration",
 *     mimeType: "application/json",
 *     handler: async () => ({
 *       text: JSON.stringify(this.configService.getConfig()),
 *     }),
 *   });
 * }
 * ```
 */
export const $resource = (
  options: ResourcePrimitiveOptions,
): ResourcePrimitive => {
  return createPrimitive(ResourcePrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ResourcePrimitiveOptions {
  /**
   * The URI that identifies this resource.
   *
   * URIs should follow a consistent scheme for your application.
   * Common patterns:
   * - `file:///path/to/file` - File system resources
   * - `db://table/id` - Database records
   * - `api://endpoint` - API responses
   * - `config://name` - Configuration values
   *
   * @example "file:///readme.md"
   * @example "db://users/123"
   */
  uri: string;

  /**
   * Human-readable name for the resource.
   *
   * If not provided, defaults to the property key where the resource is declared.
   *
   * @example "Project README"
   * @example "User Profile"
   */
  name?: string;

  /**
   * Human-friendly display title (spec 2025-11-25). Distinct from `name`,
   * which remains the programmatic identifier.
   */
  title?: string;

  /**
   * Optional icons surfaced in client UIs (spec 2025-11-25 / SEP-973).
   */
  icons?: McpIcon[];

  /**
   * Description of what this resource contains.
   *
   * Helps the LLM understand the purpose and content of the resource.
   *
   * @example "The main README file for the project"
   */
  description?: string;

  /**
   * MIME type of the resource content.
   *
   * Helps clients understand how to interpret the content.
   *
   * @default "text/plain"
   * @example "text/markdown"
   * @example "application/json"
   */
  mimeType?: string;

  /**
   * Handler function that returns the resource content.
   *
   * Called when the resource is read. Can return text or binary content.
   *
   * @returns Resource content with either `text` or `blob` property
   */
  handler: ResourceHandler;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ResourcePrimitive extends Primitive<ResourcePrimitiveOptions> {
  protected readonly mcpServer = $inject(McpServerProvider);

  /**
   * Returns the name of the resource.
   */
  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }

  /**
   * Returns the URI of the resource.
   */
  public get uri(): string {
    return this.options.uri;
  }

  /**
   * Returns the description of the resource.
   */
  public get description(): string | undefined {
    return this.options.description;
  }

  /**
   * Returns the MIME type of the resource.
   */
  public get mimeType(): string {
    return this.options.mimeType ?? "text/plain";
  }

  protected onInit(): void {
    this.mcpServer.registerResource(this);
  }

  /**
   * Read the resource content.
   *
   * @param context - Optional context from the transport layer
   * @returns The resource content
   */
  public async read(context?: McpContext): Promise<ResourceContent> {
    return this.options.handler({ context });
  }

  /**
   * Convert the resource to an MCP resource descriptor for protocol messages.
   */
  public toDescriptor(): McpResourceDescriptor {
    const descriptor: McpResourceDescriptor = {
      uri: this.uri,
      name: this.name,
      description: this.description,
      mimeType: this.mimeType,
    };
    if (this.options.title) descriptor.title = this.options.title;
    if (this.options.icons && this.options.icons.length > 0) {
      descriptor.icons = this.options.icons;
    }
    return descriptor;
  }
}

$resource[KIND] = ResourcePrimitive;
