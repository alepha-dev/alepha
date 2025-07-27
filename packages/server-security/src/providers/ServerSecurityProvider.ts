import { randomUUID } from "node:crypto";
import { $hook, $inject, $logger, Alepha } from "@alepha/core";
import {
	JwtProvider,
	type Permission,
	SecurityProvider,
	type UserAccountToken,
} from "@alepha/security";
import {
	$action,
	ForbiddenError,
	type ServerRequest,
	UnauthorizedError,
} from "@alepha/server";

export class ServerSecurityProvider {
	protected readonly log = $logger();
	protected readonly securityProvider = $inject(SecurityProvider);
	protected readonly jwtProvider = $inject(JwtProvider);
	protected readonly alepha = $inject(Alepha);

	protected readonly onConfigure = $hook({
		on: "configure",
		handler: async () => {
			for (const action of this.alepha.descriptors($action)) {
				if (action.options.disabled || action.options.secure === false) {
					// if the action is disabled or not secure, we skip it
					continue;
				}

				const route = action.route;

				const permission: Permission = {
					name: action.name,
					group: action.group,
					method: route.method,
					path: route.path,
				};

				this.securityProvider.createPermission(permission);
			}
		},
	});

	// -------------------------------------------------------------------------------------------------------------------

	protected readonly onActionRequest = $hook({
		on: "action:onRequest",
		handler: async ({ action, request, options }) => {
			const permission = this.securityProvider
				.getPermissions()
				.find(
					(it) =>
						it.path === action.route.path && it.method === action.route.method,
				);

			if (!permission && action.options.secure === false) {
				return;
			}

			const secure =
				typeof action.options.secure === "object" ? action.options.secure : {};

			try {
				request.user = this.createUserFromLocalFunctionContext(
					options,
					permission,
				);
			} catch (error) {
				if (!secure.optional) {
					throw error;
				}
			}
		},
	});

	protected readonly onRequest = $hook({
		on: "server:onRequest",
		priority: "last",
		handler: async ({ request, route }) => {
			const permission = this.securityProvider
				.getPermissions()
				.find((it) => it.path === route.path && it.method === route.method);

			if (!permission && !route.secure) {
				return;
			}

			const secure = typeof route.secure === "object" ? route.secure : {};

			try {
				request.user = await this.securityProvider.createUserFromToken(
					request.headers.authorization,
					permission,
				);
			} catch (error) {
				if (!secure.optional) {
					throw error;
				}
			}
		},
	});

	// -------------------------------------------------------------------------------------------------------------------

	/**
	 * Get the user account token for a local action call.
	 * There are three possible sources for the user:
	 * - `options.user`: the user passed in the options
	 * - `"system"`: the system user from the state (you MUST set state `server.security.system.user`)
	 * - `"context"`: the user from the request context (you MUST be in an HTTP request context)
	 *
	 * Priority order: `options.user` > `"system"` > `"context"`.
	 *
	 * In testing environment, if no user is provided, a test user is created based on the SecurityProvider's roles.
	 */
	protected createUserFromLocalFunctionContext(
		options: { user?: UserAccountToken | "system" | "context" },
		permission?: Permission,
	): UserAccountToken {
		const fromOptions =
			typeof options.user === "object" ? options.user : undefined;

		const type = typeof options.user === "string" ? options.user : undefined;

		let user: UserAccountToken | undefined;

		const fromContext = this.alepha.context.get<ServerRequest>("request")?.user;
		const fromSystem = this.alepha.state("server.security.system.user");

		if (type === "system") {
			user = fromSystem;
		} else if (type === "context") {
			user = fromContext;
		} else {
			user = fromOptions ?? fromSystem ?? fromContext;
		}

		if (!user) {
			// in testing mode, we create a test user
			if (this.alepha.isTest() && !("user" in options)) {
				return this.createTestUser();
			}

			throw new UnauthorizedError("User is required for calling this action");
		}

		const roles =
			user.roles ??
			(this.alepha.isTest()
				? this.securityProvider.getRoles().map((role) => role.name)
				: []);
		let ownership: boolean | string | undefined;

		if (permission) {
			const result = this.securityProvider.checkPermission(
				permission,
				...roles,
			);
			if (!result.isAuthorized) {
				throw new ForbiddenError(
					`Permission '${this.securityProvider.permissionToString(permission)}' is required for this route`,
				);
			}
			ownership = result.ownership;
		}

		// create a new user object with ownership if needed
		return {
			...user,
			ownership,
		};
	}

	// ---------------------------------------------------------------------------------------------------------------
	// TESTING ONLY
	// ---------------------------------------------------------------------------------------------------------------

	protected createTestUser(): UserAccountToken {
		return {
			id: randomUUID(),
			name: "Test",
			roles: this.securityProvider.getRoles().map((role) => role.name),
		};
	}

	protected readonly onClientRequest = $hook({
		on: "client:onRequest",
		handler: async ({ request, options }) => {
			if (!this.alepha.isTest()) {
				return;
			}

			// skip helper if user is explicitly set to undefined
			if ("user" in options && options.user === undefined) {
				return;
			}

			request.headers = new Headers(request.headers);

			if (!request.headers.has("authorization")) {
				const test = this.createTestUser();
				const user =
					typeof options?.user === "object" ? options.user : undefined;
				const sub = user?.id ?? test.id;
				const roles = user?.roles ?? test.roles;

				request.headers.set(
					"authorization",
					`Bearer ${await this.jwtProvider.create(
						{
							sub,
							roles,
						},
						this.securityProvider.getRealms()[0]?.name,
					)}`,
				);
			}
		},
	});
}

export type ServerRouteSecure =
	| boolean
	| {
			permissions?: string[];
			roles?: string[];
			realms?: string[];
			organizations?: string[];
	  };
