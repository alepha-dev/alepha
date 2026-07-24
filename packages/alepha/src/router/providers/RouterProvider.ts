import { AlephaError } from "alepha";

export abstract class RouterProvider<T extends Route = Route> {
  protected routePathRegex: RegExp = /^\/[A-Za-z0-9._~!$&%'()*+,;=:@{}?/-]*$/;

  protected tree: Tree<T> = { children: {} };
  protected cache = new Map<string, RouteMatch<T>>();
  protected maxCacheSize = 10_000;

  public match(path: string): RouteMatch<T> {
    const pathname = path.split("?", 1)[0];
    const hit = this.cache.get(pathname);
    if (hit) {
      return { route: hit.route, params: { ...hit.params } };
    }
    const result = this.mapParams(this.createRouteMatch(pathname));
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
        if (!cursor.param) {
          cursor.param = { name, children: {} };
        } else if (cursor.param.name !== name) {
          // damn, 2 url params with different names
          // got this case with /customers/:id and /customers/:userId/payments
          route.mapParams ??= {};
          route.mapParams[cursor.param.name] = name;
        }

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

    return this.search(this.tree, parts, 0) ?? { route: undefined, params: {} };
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
  ): RouteMatch<T> | undefined {
    if (index === parts.length) {
      if (node.route) {
        return { route: node.route, params: {} };
      }
      // "/a/*" also answers "/a" — with an empty capture.
      if (node.wildcard) {
        return { route: node.wildcard.route, params: { "*": "" } };
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
        hit.params ??= {};
        hit.params[node.param.name] = this.decodeParam(parts[index]);
        return hit;
      }
    }

    // Nearest enclosing wildcard wins. Returning `undefined` instead lets an
    // ancestor's wildcard answer, which is how a dead-end deep inside a static
    // branch unwinds to `/users/*`.
    if (node.wildcard) {
      return {
        route: node.wildcard.route,
        params: {
          "*": parts
            .slice(index)
            .map((it) => this.decodeParam(it))
            .join("/"),
        },
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

  protected mapParams(match: RouteMatch<T>): RouteMatch<T> {
    if (match.route?.mapParams && match.params) {
      for (const [key, value] of Object.entries(match.route.mapParams)) {
        if (match.params[key]) {
          match.params[value] = match.params[key];
          delete match.params[key];
        }
      }
    }

    return match;
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

  /**
   * Rename a param in the route.
   * This is automatically filled when you have scenarios like:
   * `/customers/:id` and `/customers/:userId/payments`
   *
   * In this case, `:id` will be renamed to `:userId` in the second route.
   */
  mapParams?: Record<string, string>;
}

export interface Tree<T extends Route> {
  route?: T;
  children: {
    [key: string]: Tree<T>;
  };
  param?: {
    route?: T;
    name: string;
    children: {
      [key: string]: Tree<T>;
    };
  };
  wildcard?: {
    route: T;
  };
}
