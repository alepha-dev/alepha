import {
  $inject,
  AlephaError,
  type Async,
  createPrimitive,
  type Infer,
  KIND,
  Primitive,
  type ZObject,
} from "alepha";
import type {
  CompletionHandler,
  CompletionHandlerArgs,
  McpAnnotations,
  McpContext,
  McpIcon,
  McpResourceTemplateDescriptor,
  ResourceContent,
} from "../interfaces/McpTypes.ts";
import { McpServerProvider } from "../providers/McpServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Creates an MCP resource template — a resource addressed by a *pattern*
 * rather than a fixed URI.
 *
 * {@link $resource} covers data that lives at one known address. A template
 * covers a family of them: every folio, every user, every file under a root.
 * Without it, parameterized data can only be exposed as a tool call, and the
 * client loses the ability to address it by URI or embed it as a
 * `resource_link`.
 *
 * **URI templates (RFC 6570)**
 *
 * Two forms are supported, which is what MCP servers use in practice:
 *
 * - `{var}` — simple expansion. Matches one segment; will not span `/`.
 *   The captured value is percent-decoded.
 * - `{+var}` — reserved expansion. Matches greedily, `/` included. Use it for
 *   trailing paths (`file:///{+path}`).
 *
 * Any other operator (`#`, `.`, `/`, `;`, `?`, `&`) or modifier (`*`, `:3`)
 * throws at registration rather than compiling into a pattern that quietly
 * never matches.
 *
 * @example
 * ```ts
 * class FolioResources {
 *   folio = $resourceTemplate({
 *     uriTemplate: "folio://{projectId}/{shortId}",
 *     description: "A folio, by project and short id",
 *     mimeType: "text/markdown",
 *     variables: z.object({
 *       projectId: z.text(),
 *       shortId: z.text(),
 *     }),
 *     handler: async ({ variables }) => ({
 *       text: await this.folios.read(variables.projectId, variables.shortId),
 *     }),
 *   });
 * }
 * ```
 */
export const $resourceTemplate = <T extends ZObject>(
  options: ResourceTemplatePrimitiveOptions<T>,
): ResourceTemplatePrimitive<T> => {
  return createPrimitive(ResourceTemplatePrimitive<T>, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export interface ResourceTemplatePrimitiveOptions<T extends ZObject> {
  /**
   * The RFC 6570 URI template this resource answers for.
   *
   * @example "db://users/{id}"
   * @example "folio://{projectId}/{shortId}"
   * @example "file:///{+path}"
   */
  uriTemplate: string;

  /**
   * Human-readable name. Defaults to the property key where the template is
   * declared.
   */
  name?: string;

  /**
   * Human-friendly display title (spec 2025-11-25). Distinct from `name`,
   * which remains the programmatic identifier.
   */
  title?: string;

  /**
   * Description of what this family of resources contains.
   */
  description?: string;

  /**
   * MIME type of the resource content.
   *
   * @default "text/plain"
   */
  mimeType?: string;

  /**
   * Optional icons surfaced in client UIs (spec 2025-11-25 / SEP-973).
   */
  icons?: McpIcon[];

  /**
   * Audience / priority / `lastModified` hints (spec 2025-03-26+).
   */
  annotations?: McpAnnotations;

  /**
   * Arbitrary metadata passed through to clients on the descriptor
   * (spec 2025-06-18+).
   */
  _meta?: Record<string, unknown>;

  /**
   * Zod schema validating the variables extracted from a concrete URI.
   *
   * Every extracted value starts life as a string, so this is where `id`
   * becomes a uuid or `page` becomes a number. A failure is reported as
   * `-32602 Invalid params`, which is what stops a malformed URI from
   * reaching — and crashing — the handler.
   */
  variables?: T;

  /**
   * Handler returning the content for one concrete URI.
   */
  handler: (
    args: ResourceTemplateHandlerArgs<T>,
  ) => Async<ResourceContent | undefined>;

  /**
   * Optional autocompletion for the template's URI variables, served over
   * `completion/complete`.
   *
   * @example
   * ```ts
   * complete: async ({ argument }) =>
   *   argument.name === "projectId"
   *     ? (await this.projects.ids()).filter((id) => id.startsWith(argument.value))
   *     : [],
   * ```
   */
  complete?: CompletionHandler;
}

export interface ResourceTemplateHandlerArgs<T extends ZObject> {
  /** Values extracted from the URI, validated against `variables`. */
  variables: Infer<T>;
  /** The concrete URI that matched. */
  uri: string;
  context?: McpContext;
}

// ---------------------------------------------------------------------------------------------------------------------

export class ResourceTemplatePrimitive<T extends ZObject> extends Primitive<
  ResourceTemplatePrimitiveOptions<T>
> {
  protected readonly mcpServer = $inject(McpServerProvider);

  /** Lazily compiled matcher — see {@link compile}. */
  protected matcher?: { regex: RegExp; names: string[]; reserved: boolean[] };

  public get name(): string {
    return this.options.name ?? this.config.propertyKey;
  }

  public get uriTemplate(): string {
    return this.options.uriTemplate;
  }

  public get description(): string | undefined {
    return this.options.description;
  }

  public get mimeType(): string {
    return this.options.mimeType ?? "text/plain";
  }

  /**
   * Whether this template offers autocompletion for its URI variables.
   */
  public hasCompletion(): boolean {
    return !!this.options.complete;
  }

  protected onInit(): void {
    // Compile eagerly so a malformed template fails at container start, where
    // the stack points at the declaration — not on the first client read.
    this.compile();
    this.mcpServer.registerResourceTemplate(this);
  }

  /**
   * Candidate values for one of this template's URI variables. Empty when the
   * template declares no `complete` handler.
   */
  public async complete(args: CompletionHandlerArgs): Promise<string[]> {
    return (await this.options.complete?.(args)) ?? [];
  }

  /**
   * Extract this template's variables from a concrete URI, or `undefined` when
   * the URI does not match.
   */
  public match(uri: string): Record<string, string> | undefined {
    const { regex, names, reserved } = this.compile();
    const found = regex.exec(uri);
    if (!found) {
      return undefined;
    }
    const variables: Record<string, string> = {};
    names.forEach((name, i) => {
      const raw = found[i + 1];
      // Simple expansion percent-encodes reserved characters, so it must be
      // decoded. Reserved expansion does not, and decoding it would corrupt a
      // path that legitimately contains a `%`.
      variables[name] = reserved[i] ? raw : this.decode(raw);
    });
    return variables;
  }

  /**
   * Read the resource at a concrete URI matching this template.
   */
  public async read(
    uri: string,
    variables: Record<string, string>,
    context?: McpContext,
  ): Promise<ResourceContent | undefined> {
    let validated: any = variables;

    if (this.options.variables) {
      validated = this.alepha.codec.decode(this.options.variables, variables);
    }

    return this.options.handler({ variables: validated, uri, context });
  }

  public toDescriptor(): McpResourceTemplateDescriptor {
    const descriptor: McpResourceTemplateDescriptor = {
      uriTemplate: this.uriTemplate,
      name: this.name,
      description: this.description,
      mimeType: this.mimeType,
    };
    if (this.options.title) descriptor.title = this.options.title;
    if (this.options.icons && this.options.icons.length > 0) {
      descriptor.icons = this.options.icons;
    }
    if (this.options.annotations) {
      descriptor.annotations = this.options.annotations;
    }
    if (this.options._meta) descriptor._meta = this.options._meta;
    return descriptor;
  }

  /**
   * Turn the URI template into an anchored regular expression plus the ordered
   * list of variable names it captures.
   */
  protected compile(): {
    regex: RegExp;
    names: string[];
    reserved: boolean[];
  } {
    if (this.matcher) {
      return this.matcher;
    }

    const template = this.options.uriTemplate;
    const names: string[] = [];
    const reserved: boolean[] = [];
    let pattern = "";
    let cursor = 0;

    const expression = /\{([^}]*)\}/g;
    let match = expression.exec(template);
    while (match) {
      pattern += this.escape(template.slice(cursor, match.index));

      const spec = match[1];
      const isReserved = spec.startsWith("+");
      const varName = isReserved ? spec.slice(1) : spec;

      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
        throw new AlephaError(
          `Unsupported URI template expression "{${spec}}" in "${template}". ` +
            `Only {var} (simple) and {+var} (reserved) expansion are supported.`,
        );
      }
      if (names.includes(varName)) {
        throw new AlephaError(
          `Duplicate variable "${varName}" in URI template "${template}".`,
        );
      }

      names.push(varName);
      reserved.push(isReserved);
      // Simple expansion never spans a path separator; reserved expansion may.
      pattern += isReserved ? "(.+)" : "([^/]+)";

      cursor = match.index + match[0].length;
      match = expression.exec(template);
    }

    pattern += this.escape(template.slice(cursor));

    if (names.length === 0) {
      throw new AlephaError(
        `URI template "${template}" declares no variables — use $resource for a fixed URI.`,
      );
    }

    this.matcher = { regex: new RegExp(`^${pattern}$`), names, reserved };
    return this.matcher;
  }

  protected escape(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  protected decode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      // A lone `%` is not valid percent-encoding. The raw value is closer to
      // what the client meant than an exception is, and the variables schema
      // gets the final say anyway.
      return value;
    }
  }
}

$resourceTemplate[KIND] = ResourceTemplatePrimitive;
