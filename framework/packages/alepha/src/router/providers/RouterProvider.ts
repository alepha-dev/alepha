import { AlephaError } from "alepha";

export abstract class RouterProvider<T extends Route = Route> {
  protected routePathRegex: RegExp = /^\/[A-Za-z0-9._~!$&%'()*+,;=:@{}?/-]*$/;

  protected tree: Tree<T> = { children: {} };
  protected cache = new Map<string, RouteMatch<T>>();
  protected maxCacheSize = 10_000;

  /**
   * Each route's OWN param names, by segment index.
   *
   * The tree cannot hold these. One position is one node, shared by every
   * route that passes through it, and a node can only remember one name - so
   * `/p/:projectId/x` and `/p/:projectSlug/y` had to agree on which. Captures
   * are collected by position during the search and named from here once a
   * route has actually matched, which is the only point at which the right
   * names are known.
   */
  protected readonly paramNames = new WeakMap<T, Map<number, string>>();

  public match(path: string): RouteMatch<T> {
    const pathname = path.split("?", 1)[0];
    const hit = this.cache.get(pathname);
    if (hit) {
      return { route: hit.route, params: { ...hit.params } };
    }
    const result = this.createRouteMatch(pathname);
    if (this.cache.size >= this.maxCacheSize) this.cache.clear();
    this.cache.set(pathname, result);
    return { route: result.route, params: { ...result.params } };
  }

  protected test(path: string): void {
    if (!this.routePathRegex.test(path)) {
      throw new AlephaError(`Route '${path}' is not valid`);
    }
  }

  protected push(route: T): void {
    const path = route.path.replaceAll("//", "/");

    this.test(path);
    this.cache.clear();

    const parts = this.createParts(path);

    let cursor = this.tree;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      let part = parts[i].toLowerCase(); // url is case-insensitive
      if (part === "*" && isLast) {
        cursor.wildcard = { route };
        break;
      }

      if (part.includes("*")) {
        throw new AlephaError(`Route '${path}' has an invalid wildcard syntax`);
      }

      if (part.includes("{") || part.includes("}")) {
        if (part.startsWith("{") && part.endsWith("}")) {
          part = `:${part.slice(1, -1)}`; // convert {param} to :param
        } else {
          throw new AlephaError(`Route '${path}' has an invalid param syntax`);
        }
      }

      if (part.startsWith(":")) {
        const name = parts[i].slice(1).replaceAll("}", "");
        if (!name) {
          throw new AlephaError(`Route '${path}' has an empty param name`);
        }

        // Two routes may disagree about what this position is called, and
        // that is fine: the node keeps whichever name arrived first, purely
        // as a description of the shape, while the name that will be USED is
        // recorded against this route at this index.
        if (!cursor.param) {
          cursor.param = { name, children: {} };
        }

        let names = this.paramNames.get(route);
        if (!names) {
          names = new Map();
          this.paramNames.set(route, names);
        }
        names.set(i, name);

        if (isLast) {
          cursor.param.route = route;
        }

        cursor = cursor.param;
        continue;
      }

      if (!cursor.children[part]) {
        cursor.children[part] = { children: {} };
      }

      if (isLast) {
        cursor.children[part].route = route;
      }

      cursor = cursor.children[part];
    }
  }

  protected createRouteMatch(path: string): RouteMatch<T> {
    if (path[0] !== "/") {
      throw new AlephaError(`Path '${path}' must start with "/"`);
    }

    const parts = this.createParts(path);
    const hit = this.search(this.tree, parts, 0);

    if (!hit) {
      return { route: undefined, params: {} };
    }

    const params: Record<string, string> = {};
    const names = hit.route ? this.paramNames.get(hit.route) : undefined;

    for (const [index, value] of hit.captures) {
      const name = names?.get(index);
      // A position the matched route does not name is a position it does not
      // want: only a route registered UNDER a param node can be reached
      // through one, so this only skips a wildcard's trailing segments.
      if (name) {
        params[name] = value;
      }
    }

    if (hit.wildcard !== undefined) {
      params["*"] = hit.wildcard;
    }

    return { route: hit.route, params };
  }

  /**
   * Depth-first search with backtracking, static child first.
   *
   * A greedy walk cannot do this: with `/a/{x}` and `/a/b/c` registered it
   * descends into the static `b`, finds no route there, and gives up — 404 on
   * a route the caller declared. Here a failed subtree returns `undefined` and
   * the caller tries the next alternative at its own level.
   *
   * Params are attached while unwinding a *successful* branch, so captures
   * made along an abandoned one cannot leak into the result.
   */
  protected search(
    node: Tree<T>,
    parts: string[],
    index: number,
  ): InternalMatch<T> | undefined {
    if (index === parts.length) {
      if (node.route) {
        return { route: node.route, captures: [] };
      }
      // "/a/*" also answers "/a" — with an empty capture.
      if (node.wildcard) {
        return { route: node.wildcard.route, captures: [], wildcard: "" };
      }
      return undefined;
    }

    const part = parts[index].toLowerCase(); // url is case-insensitive

    const child = node.children[part];
    if (child) {
      const hit = this.search(child, parts, index + 1);
      if (hit) {
        return hit;
      }
    }

    if (node.param) {
      const hit = this.search(node.param as Tree<T>, parts, index + 1);
      if (hit) {
        // By POSITION, not by the node's name. Two segments of one path used
        // to collide whenever the tree happened to call them the same thing,
        // and the outer one, applied last on the way out, won.
        hit.captures.push([index, this.decodeParam(parts[index])]);
        return hit;
      }
    }

    // Nearest enclosing wildcard wins. Returning `undefined` instead lets an
    // ancestor's wildcard answer, which is how a dead-end deep inside a static
    // branch unwinds to `/users/*`.
    if (node.wildcard) {
      return {
        route: node.wildcard.route,
        captures: [],
        wildcard: parts
          .slice(index)
          .map((it) => this.decodeParam(it))
          .join("/"),
      };
    }

    return undefined;
  }

  /**
   * Percent-decode a captured segment.
   *
   * Query values already go through a decoder, so leaving path params raw made
   * the same string arrive decoded as `?q=john%20doe` and literal as
   * `/:id`. A malformed sequence (`100%`) is kept verbatim rather than
   * throwing — a bad escape in a URL is a 404 at worst, never a 500.
   */
  protected decodeParam(value: string): string {
    if (!value.includes("%")) {
      return value;
    }

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  protected createParts(path: string): string[] {
    let pathname = path.split("?")[0].replaceAll("//", "/");

    // remove trailing slash
    if (pathname.endsWith("/") && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }

    return pathname.split("/").slice(1);
  }
}

export interface RouteMatch<T extends Route> {
  route?: T;
  params?: Record<string, string>;
}

export interface Route {
  path: string;
}

/**
 * A match on its way out of the tree, before the captures have names.
 *
 * Positions rather than names, because the names belong to the route and the
 * route is only known once the walk reaches one.
 */
interface InternalMatch<T extends Route> {
  route?: T;
  captures: Array<[index: number, value: string]>;
  /**
   * The tail a `*` segment swallowed, when one matched. `""` when the
   * wildcard answered for its own prefix.
   */
  wildcard?: string;
}

export interface Tree<T extends Route> {
  route?: T;
  children: {
    [key: string]: Tree<T>;
  };
  param?: {
    route?: T;
    /**
     * Whichever route named this position first. Descriptive only: what a
     * capture here is CALLED depends on the route that matches, not on the
     * node - see `paramNames`.
     */
    name: string;
    children: {
      [key: string]: Tree<T>;
    };
  };
  wildcard?: {
    route: T;
  };
}
