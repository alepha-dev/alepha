export abstract class RouterProvider<T extends Route = Route> {
	protected routePathRegex: RegExp = /^(\/[:*]?[.\-_a-zA-Z0-9]*)*$/;
	protected tree: Tree<T> = { children: {} };
	protected readonly routes: T[] = [];

	public match(path: string): RouteMatch<T> {
		return this.mapParams(this.createRouteMatch(path));
	}

	protected push(route: T): void {
		if (!this.routePathRegex.test(route.path)) {
			throw new Error(`Route "${route.path}" is not valid`);
		}

		const parts = this.createParts(route.path);

		let cursor = this.tree;
		for (let i = 0; i < parts.length; i++) {
			const isLast = i === parts.length - 1;
			const part = parts[i].toLowerCase(); // url is case-insensitive
			if (part === "*") {
				cursor.wildcard = { route };
				break;
			}

			if (part.startsWith(":")) {
				const name = parts[i].slice(1);
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

		this.routes.push(route);
	}

	protected createRouteMatch(path: string): RouteMatch<T> {
		if (path[0] !== "/") {
			throw new Error(`Path "${path}" must start with "/"`);
		}

		const parts = this.createParts(path);

		let cursor = this.tree;
		let wildcard: { route: T } | undefined;
		const params: Record<string, string> = {};

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i].toLowerCase(); // url is case-insensitive
			if (cursor.children[part]) {
				if (cursor.wildcard) {
					wildcard = cursor.wildcard;
				}
				cursor = cursor.children[part];
			} else if (cursor.param) {
				if (cursor.wildcard) {
					wildcard = cursor.wildcard;
				}
				params[cursor.param.name] = parts[i];
				cursor = cursor.param;
			} else if (cursor.wildcard) {
				params["*"] = parts.slice(i).join("/");
				return { route: cursor.wildcard.route, params };
			} else {
				return { route: wildcard?.route, params };
			}
		}

		if (!cursor?.route) {
			// when "/a/*" - trigger if "/a"
			if (cursor.wildcard) {
				return { route: cursor.wildcard.route, params };
			}
			// return deep wildcard or nothing
			return { route: wildcard?.route, params };
		}

		return { route: cursor.route, params };
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
