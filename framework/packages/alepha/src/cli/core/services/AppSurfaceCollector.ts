import {
  type Alepha,
  type AppSurface,
  type AppSurfaceClass,
  ContainerGraph,
  type Primitive,
  type PurityEntry,
  type Service,
} from "alepha";

/**
 * The build list of an app (#Q3401): its pure controllers and every
 * primitive a runtime or a reader needs without creating the class.
 *
 * Read from the app's container once it is loaded, never started: the build
 * imports the entry and stops there, so the list holds what exists after
 * load. Primitives are reached by kind name, the way the build's other tasks
 * reach them, so a kind whose module the app does not use is simply absent.
 */
export class AppSurfaceCollector {
  public collect(alepha: Alepha): AppSurface {
    const purity = alepha.purity();
    const classes = this.classesOf(purity, this.securityOf(alepha));
    const keyOf = (primitive: Primitive<any>) =>
      ContainerGraph.keyOf(primitive.config.service as Service);

    const links = this.linksOf(alepha);
    const actions: AppSurface["actions"] = [];
    for (const action of alepha.primitives("$action") as any[]) {
      if (action.options?.disabled) {
        continue;
      }
      const contentType = action.getBodyContentType?.();
      actions.push(
        this.compact({
          name: action.name,
          group: action.group,
          method: action.method,
          path: action.path,
          contentType:
            contentType && contentType !== "application/json"
              ? contentType
              : undefined,
          secured: links?.securedOptions(action.middlewares) as
            | AppSurface["actions"][number]["secured"]
            | undefined,
          mcp: action.options?.mcp ? true : undefined,
          class: keyOf(action),
        }),
      );
    }
    for (const sse of alepha.primitives("$sse") as any[]) {
      if (sse.options?.disabled) {
        continue;
      }
      actions.push(
        this.compact({
          name: sse.name,
          group: sse.group,
          method: "POST",
          path: sse.path,
          kind: "sse" as const,
          class: keyOf(sse),
        }),
      );
    }

    return {
      version: 1,
      classes,
      actions,
      routes: (alepha.primitives("$route") as any[]).map((route) => ({
        method: String(route.options?.method ?? "GET").toUpperCase(),
        path: route.options?.path,
        class: keyOf(route),
      })),
      pages: (alepha.primitives("$page") as any[]).map((page) =>
        this.compact({
          name: page.name,
          path: page.options?.path,
          parent: page.options?.parent?.name,
          class: keyOf(page),
        }),
      ),
      jobs: (alepha.primitives("$job") as any[]).map((job) =>
        this.compact({
          name: job.name,
          cron: job.options?.cron,
          class: keyOf(job),
        }),
      ),
      tools: this.named(alepha, "$tool", keyOf),
      resources: [
        ...this.named(alepha, "$resource", keyOf),
        ...this.named(alepha, "$resourceTemplate", keyOf),
      ],
      prompts: this.named(alepha, "$prompt", keyOf),
    };
  }

  /**
   * What `alepha build` prints: the pure count, then each controller that is
   * not pure with its reasons. Informative only, it never fails a build.
   */
  public report(surface: AppSurface): string[] {
    const notPure = surface.classes.filter((it) => !it.pure);
    const lines = [
      `${surface.classes.length - notPure.length} of ${surface.classes.length} controllers are pure`,
    ];
    for (const it of notPure) {
      lines.push(`  ${it.key}: ${(it.reasons ?? []).join("; ")}`);
    }
    return lines;
  }

  // -------------------------------------------------------------------------------------------------------------------

  protected classesOf(
    purity: PurityEntry[],
    security?: { permissionsDeclaredBy: (service: Service) => string[] },
  ): AppSurfaceClass[] {
    const counts = new Map<string, number>();
    for (const entry of purity) {
      const key = ContainerGraph.keyOf(entry.service);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return purity.map((entry) => {
      const key = ContainerGraph.keyOf(entry.service);
      // Two classes under one key cannot be told apart at runtime, so
      // neither may be deferred: the runtime would create the wrong one.
      if ((counts.get(key) ?? 0) > 1) {
        return {
          key,
          pure: false,
          reasons: [...entry.reasons, "name is not unique"],
        };
      }
      if (!entry.pure) {
        return { key, pure: false, reasons: entry.reasons };
      }
      const permissions = security?.permissionsDeclaredBy(entry.service);
      return this.compact({
        key,
        pure: true,
        closure: entry.closure.length
          ? entry.closure.map((it) => ContainerGraph.keyOf(it))
          : undefined,
        // Registered at boot from the list, since the class is not (#Q3416).
        permissions: permissions?.length ? permissions : undefined,
      });
    });
  }

  protected named(
    alepha: Alepha,
    kind: string,
    keyOf: (primitive: Primitive<any>) => string,
  ): Array<{ name: string; class: string }> {
    return (alepha.primitives(kind) as any[]).map((it) => ({
      name: it.name,
      class: keyOf(it),
    }));
  }

  /**
   * The links provider, when the app has a server, for the `secured` shape
   * `/api/_links` publishes.
   */
  protected linksOf(alepha: Alepha):
    | {
        securedOptions: (middlewares: unknown[]) => unknown;
      }
    | undefined {
    try {
      return alepha.inject("alepha.server.links.ServerLinksProvider") as any;
    } catch {
      return undefined;
    }
  }

  /**
   * The security provider, when the app has one, for the permissions each
   * class declared through `$secure`.
   */
  protected securityOf(
    alepha: Alepha,
  ): { permissionsDeclaredBy: (service: Service) => string[] } | undefined {
    try {
      return alepha.inject("alepha.security.SecurityProvider") as any;
    } catch {
      return undefined;
    }
  }

  /**
   * Drops the undefined fields, so the list stays small in the manifest.
   */
  protected compact<T extends object>(value: T): T {
    for (const key of Object.keys(value) as Array<keyof T>) {
      if (value[key] === undefined) {
        delete value[key];
      }
    }
    return value;
  }
}
