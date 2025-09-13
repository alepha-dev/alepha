import {
	$env,
	$inject,
	type Async,
	createDescriptor,
	Descriptor,
	isTypeFile,
	KIND,
	type Static,
	type TSchema,
	t,
} from "@alepha/core";
import { $logger } from "@alepha/logger";
import type { RouteMethod } from "../constants/routeMethods.ts";
import { isMultipart } from "../helpers/isMultipart.ts";
import { ServerReply } from "../helpers/ServerReply.ts";
import type {
	RequestConfigSchema,
	ServerRequest,
	ServerResponseBody,
	ServerRoute,
} from "../interfaces/ServerRequest.ts";
import { ServerProvider } from "../providers/ServerProvider.ts";
import { ServerRouterProvider } from "../providers/ServerRouterProvider.ts";
import {
	type FetchOptions,
	type FetchResponse,
	HttpClient,
} from "../services/HttpClient.ts";

/**
 * Creates a server action descriptor for defining type-safe HTTP endpoints.
 *
 * Server actions are the core building blocks for REST APIs in the Alepha framework. They provide
 * a declarative way to define HTTP endpoints with full TypeScript type safety, automatic schema
 * validation, and integrated security features. Actions automatically handle routing, request
 * parsing, response serialization, and OpenAPI documentation generation.
 *
 * **Key Features**
 *
 * - **Type Safety**: Full TypeScript inference for request/response types
 * - **Schema Validation**: Automatic validation using TypeBox schemas
 * - **Auto-routing**: Convention-based URL generation with customizable paths
 * - **Multiple Invocation**: Call directly (`run()`) or via HTTP (`fetch()`)
 * - **OpenAPI Integration**: Automatic documentation generation
 * - **Security Integration**: Built-in authentication and authorization support
 * - **Content Type Detection**: Automatic handling of JSON, form-data, and plain text
 *
 * **URL Generation**
 *
 * By default, actions are prefixed with `/api` (configurable via `SERVER_API_PREFIX`):
 * - Property name becomes the endpoint path
 * - Path parameters are automatically detected from schema
 * - HTTP method defaults to GET, or POST if body schema is provided
 *
 * **Use Cases**
 *
 * Perfect for building robust REST APIs:
 * - CRUD operations with full type safety
 * - File upload and download endpoints
 * - Real-time data processing APIs
 * - Integration with external services
 * - Microservice communication
 * - Admin and management interfaces
 *
 * @example
 * **Basic CRUD operations:**
 * ```ts
 * import { $action } from "@alepha/server";
 * import { t } from "@alepha/core";
 *
 * class UserController {
 *   // GET /api/users
 *   getUsers = $action({
 *     description: "Retrieve all users with pagination",
 *     schema: {
 *       query: t.object({
 *         page: t.optional(t.number({ default: 1 })),
 *         limit: t.optional(t.number({ default: 10, maximum: 100 })),
 *         search: t.optional(t.string())
 *       }),
 *       response: t.object({
 *         users: t.array(t.object({
 *           id: t.string(),
 *           name: t.string(),
 *           email: t.string(),
 *           createdAt: t.string({ format: "date-time" })
 *         })),
 *         total: t.number(),
 *         hasMore: t.boolean()
 *       })
 *     },
 *     handler: async ({ query }) => {
 *       const { page, limit, search } = query;
 *       const users = await this.userService.findUsers({ page, limit, search });
 *
 *       return {
 *         users: users.items,
 *         total: users.total,
 *         hasMore: (page * limit) < users.total
 *       };
 *     }
 *   });
 *
 *   // POST /api/users
 *   createUser = $action({
 *     description: "Create a new user account",
 *     schema: {
 *       body: t.object({
 *         name: t.string({ minLength: 2, maxLength: 100 }),
 *         email: t.string({ format: "email" }),
 *         password: t.string({ minLength: 8 }),
 *         role: t.optional(t.enum(["user", "admin"]))
 *       }),
 *       response: t.object({
 *         id: t.string(),
 *         name: t.string(),
 *         email: t.string(),
 *         role: t.string(),
 *         createdAt: t.string({ format: "date-time" })
 *       })
 *     },
 *     handler: async ({ body }) => {
 *       // Password validation and hashing
 *       await this.authService.validatePassword(body.password);
 *       const hashedPassword = await this.authService.hashPassword(body.password);
 *
 *       // Create user with default role
 *       const user = await this.userService.create({
 *         ...body,
 *         password: hashedPassword,
 *         role: body.role || "user"
 *       });
 *
 *       // Return user without password
 *       const { password, ...publicUser } = user;
 *       return publicUser;
 *     }
 *   });
 *
 *   // GET /api/users/:id
 *   getUser = $action({
 *     description: "Retrieve user by ID",
 *     schema: {
 *       params: t.object({
 *         id: t.string()
 *       }),
 *       response: t.object({
 *         id: t.string(),
 *         name: t.string(),
 *         email: t.string(),
 *         role: t.string(),
 *         profile: t.optional(t.object({
 *           bio: t.string(),
 *           avatar: t.string({ format: "uri" }),
 *           location: t.string()
 *         }))
 *       })
 *     },
 *     handler: async ({ params }) => {
 *       const user = await this.userService.findById(params.id);
 *       if (!user) {
 *         throw new Error(`User not found: ${params.id}`);
 *       }
 *       return user;
 *     }
 *   });
 *
 *   // PUT /api/users/:id
 *   updateUser = $action({
 *     method: "PUT",
 *     description: "Update user information",
 *     schema: {
 *       params: t.object({ id: t.string() }),
 *       body: t.object({
 *         name: t.optional(t.string({ minLength: 2 })),
 *         email: t.optional(t.string({ format: "email" })),
 *         profile: t.optional(t.object({
 *           bio: t.optional(t.string()),
 *           avatar: t.optional(t.string({ format: "uri" })),
 *           location: t.optional(t.string())
 *         }))
 *       }),
 *       response: t.object({
 *         id: t.string(),
 *         name: t.string(),
 *         email: t.string(),
 *         updatedAt: t.string({ format: "date-time" })
 *       })
 *     },
 *     handler: async ({ params, body }) => {
 *       const updatedUser = await this.userService.update(params.id, body);
 *       return updatedUser;
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **File upload with multipart form data:**
 * ```ts
 * class FileController {
 *   uploadAvatar = $action({
 *     method: "POST",
 *     description: "Upload user avatar image",
 *     schema: {
 *       body: t.object({
 *         file: t.file({
 *           maxSize: 5 * 1024 * 1024, // 5MB
 *           allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"]
 *         }),
 *         userId: t.string()
 *       }),
 *       response: t.object({
 *         url: t.string({ format: "uri" }),
 *         size: t.number(),
 *         mimeType: t.string(),
 *         uploadedAt: t.string({ format: "date-time" })
 *       })
 *     },
 *     handler: async ({ body }) => {
 *       const { file, userId } = body;
 *
 *       // Validate file
 *       await this.fileService.validateImage(file);
 *
 *       // Generate unique filename
 *       const filename = `avatars/${userId}/${Date.now()}-${file.name}`;
 *
 *       // Upload to storage
 *       const uploadResult = await this.storageService.upload(filename, file);
 *
 *       // Update user profile
 *       await this.userService.updateAvatar(userId, uploadResult.url);
 *
 *       return {
 *         url: uploadResult.url,
 *         size: file.size,
 *         mimeType: file.type,
 *         uploadedAt: new Date().toISOString()
 *       };
 *     }
 *   });
 *
 *   downloadFile = $action({
 *     method: "GET",
 *     description: "Download file by ID",
 *     schema: {
 *       params: t.object({ id: t.string() }),
 *       query: t.object({
 *         download: t.optional(t.boolean()),
 *         thumbnail: t.optional(t.boolean())
 *       }),
 *       response: t.file()
 *     },
 *     handler: async ({ params, query, reply, user }) => {
 *       const file = await this.fileService.findById(params.id);
 *       if (!file) {
 *         throw new Error("File not found");
 *       }
 *
 *       // Check permissions
 *       await this.fileService.checkAccess(params.id, user.id);
 *
 *       const fileBuffer = query.thumbnail
 *         ? await this.fileService.getThumbnail(file.id)
 *         : await this.fileService.getBuffer(file.path);
 *
 *       // Set appropriate headers
 *       reply.header("Content-Type", file.mimeType);
 *       reply.header("Content-Length", fileBuffer.length);
 *
 *       if (query.download) {
 *         reply.header("Content-Disposition", `attachment; filename="${file.name}"`);
 *       }
 *
 *       return fileBuffer;
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **Advanced API with custom paths and grouped operations:**
 * ```ts
 * class OrderController {
 *   group = "orders"; // Groups all actions under "orders" tag
 *
 *   // GET /api/orders/search
 *   searchOrders = $action({
 *     name: "search",
 *     path: "/orders/search", // Custom path
 *     description: "Advanced order search with filtering",
 *     schema: {
 *       query: t.object({
 *         status: t.optional(t.union([
 *           t.literal("pending"),
 *           t.literal("processing"),
 *           t.literal("shipped"),
 *           t.literal("delivered"),
 *           t.literal("cancelled")
 *         ])),
 *         customerId: t.optional(t.string()),
 *         dateFrom: t.optional(t.string({ format: "date" })),
 *         dateTo: t.optional(t.string({ format: "date" })),
 *         minAmount: t.optional(t.number({ minimum: 0 })),
 *         maxAmount: t.optional(t.number({ minimum: 0 })),
 *         sortBy: t.optional(t.union([
 *           t.literal("createdAt"),
 *           t.literal("amount"),
 *           t.literal("status")
 *         ])),
 *         sortOrder: t.optional(t.enum(["asc", "desc"]))
 *       }),
 *       response: t.object({
 *         orders: t.array(t.object({
 *           id: t.string(),
 *           orderNumber: t.string(),
 *           customerId: t.string(),
 *           customerName: t.string(),
 *           status: t.string(),
 *           totalAmount: t.number(),
 *           createdAt: t.string({ format: "date-time" }),
 *           itemCount: t.number()
 *         })),
 *         pagination: t.object({
 *           page: t.number(),
 *           limit: t.number(),
 *           total: t.number(),
 *           hasMore: t.boolean()
 *         }),
 *         filters: t.object({
 *           appliedFilters: t.array(t.string()),
 *           availableStatuses: t.array(t.string())
 *         })
 *       })
 *     },
 *     handler: async ({ query }) => {
 *       // Build dynamic query based on filters
 *       const searchCriteria = this.orderService.buildSearchCriteria(query);
 *       const results = await this.orderService.searchOrders(searchCriteria);
 *
 *       return {
 *         orders: results.orders,
 *         pagination: results.pagination,
 *         filters: {
 *           appliedFilters: Object.keys(query).filter(key => query[key] !== undefined),
 *           availableStatuses: await this.orderService.getAvailableStatuses()
 *         }
 *       };
 *     }
 *   });
 *
 *   // POST /api/orders/:id/process
 *   processOrder = $action({
 *     method: "POST",
 *     path: "/orders/:id/process",
 *     description: "Process an order through the fulfillment workflow",
 *     schema: {
 *       params: t.object({ id: t.string() }),
 *       body: t.object({
 *         notes: t.optional(t.string()),
 *         priority: t.optional(t.union([
 *           t.literal("low"),
 *           t.literal("normal"),
 *           t.literal("high"),
 *           t.literal("urgent")
 *         ])),
 *         assignToWarehouse: t.optional(t.string())
 *       }),
 *       response: t.object({
 *         orderId: t.string(),
 *         status: t.string(),
 *         processedAt: t.string({ format: "date-time" }),
 *         estimatedFulfillment: t.string({ format: "date-time" }),
 *         trackingInfo: t.optional(t.object({
 *           trackingNumber: t.string(),
 *           carrier: t.string(),
 *           estimatedDelivery: t.string({ format: "date" })
 *         }))
 *       })
 *     },
 *     handler: async ({ params, body, user }) => {
 *       // Validate order can be processed
 *       const order = await this.orderService.findById(params.id);
 *       if (!order || order.status !== "pending") {
 *         throw new Error("Order cannot be processed in current status");
 *       }
 *
 *       // Check inventory availability
 *       const inventoryCheck = await this.inventoryService.checkAvailability(order.items);
 *       if (!inventoryCheck.available) {
 *         throw new Error(`Insufficient inventory: ${inventoryCheck.missingItems.join(", ")}`);
 *       }
 *
 *       // Process the order
 *       const processResult = await this.fulfillmentService.processOrder({
 *         orderId: params.id,
 *         options: {
 *           notes: body.notes,
 *           priority: body.priority || "normal",
 *           warehouse: body.assignToWarehouse
 *         }
 *       });
 *
 *       // Update order status
 *       await this.orderService.updateStatus(params.id, "processing", {
 *         processedBy: user.id,
 *         processedAt: new Date(),
 *         notes: body.notes
 *       });
 *
 *       // Send notification
 *       await this.notificationService.sendOrderUpdate(order.customerId, {
 *         orderId: params.id,
 *         status: "processing",
 *         message: "Your order is now being processed"
 *       });
 *
 *       return {
 *         orderId: params.id,
 *         status: "processing",
 *         processedAt: new Date().toISOString(),
 *         estimatedFulfillment: processResult.estimatedCompletion,
 *         trackingInfo: processResult.trackingInfo
 *       };
 *     }
 *   });
 * }
 * ```
 *
 * @example
 * **Actions with security integration and role-based access:**
 * ```ts
 * class AdminController {
 *   group = "admin";
 *
 *   // Only accessible to users with "admin:users:read" permission
 *   getUserStats = $action({
 *     description: "Get comprehensive user statistics",
 *     security: { permissions: ["admin:users:read"] },
 *     schema: {
 *       query: t.object({
 *         includeInactive: t.optional(t.boolean())
 *       }),
 *       response: t.object({
 *         totalUsers: t.number(),
 *         activeUsers: t.number(),
 *         newUsers: t.number(),
 *         userGrowth: t.number(),
 *         breakdown: t.object({
 *           byRole: t.record(t.string(), t.number()),
 *           byStatus: t.record(t.string(), t.number()),
 *           byRegistrationSource: t.record(t.string(), t.number())
 *         }),
 *         trends: t.array(t.object({
 *           date: t.string({ format: "date" }),
 *           registrations: t.number(),
 *           activations: t.number()
 *         }))
 *       })
 *     },
 *     handler: async ({ query, user }) => {
 *       // user is available through security integration
 *       this.auditLogger.log({
 *         action: "admin.getUserStats",
 *         userId: user.id,
 *         userRole: user.role,
 *         timestamp: new Date()
 *       });
 *
 *       const period = query.period || "month";
 *       const stats = await this.analyticsService.getUserStatistics({
 *         period,
 *         includeInactive: query.includeInactive || false
 *       });
 *
 *       return stats;
 *     }
 *   });
 *
 *   // Bulk operations with transaction support
 *   bulkUpdateUsers = $action({
 *     method: "POST",
 *     path: "/admin/users/bulk-update",
 *     description: "Bulk update user properties",
 *     security: { permissions: ["admin:users:write"] },
 *     schema: {
 *       body: t.object({
 *         userIds: t.array(t.string(), { minItems: 1, maxItems: 1000 }),
 *         updates: t.object({
 *           status: t.optional(t.union([t.literal("active"), t.literal("inactive")])),
 *           role: t.optional(t.string()),
 *           tags: t.optional(t.array(t.string())),
 *           customFields: t.optional(t.record(t.string(), t.any()))
 *         }),
 *         reason: t.string({ minLength: 10, maxLength: 500 })
 *       }),
 *       response: t.object({
 *         updated: t.number(),
 *         failed: t.number(),
 *         errors: t.array(t.object({
 *           userId: t.string(),
 *           error: t.string()
 *         })),
 *         auditLogId: t.string()
 *       })
 *     },
 *     handler: async ({ body, user }) => {
 *       const results = { updated: 0, failed: 0, errors: [] };
 *
 *       // Create audit log entry
 *       const auditLogId = await this.auditService.logBulkOperation({
 *         operation: "bulk_user_update",
 *         initiatedBy: user.id,
 *         targetCount: body.userIds.length,
 *         reason: body.reason,
 *         changes: body.updates
 *       });
 *
 *       // Process in batches to avoid overwhelming the database
 *       const batchSize = 50;
 *       for (let i = 0; i < body.userIds.length; i += batchSize) {
 *         const batch = body.userIds.slice(i, i + batchSize);
 *
 *         try {
 *           const updateResult = await this.userService.bulkUpdate(batch, body.updates);
 *           results.updated += updateResult.success;
 *           results.failed += updateResult.failed;
 *           results.errors.push(...updateResult.errors);
 *         } catch (error) {
 *           // Log batch failure but continue processing
 *           this.logger.error(`Bulk update batch failed`, {
 *             batch: i / batchSize + 1,
 *             userIds: batch,
 *             error: error.message
 *           });
 *
 *           results.failed += batch.length;
 *           results.errors.push(...batch.map(userId => ({
 *             userId,
 *             error: error.message
 *           })));
 *         }
 *       }
 *
 *       // Update audit log with results
 *       await this.auditService.updateBulkOperationResults(auditLogId, results);
 *
 *       return { ...results, auditLogId };
 *     }
 *   });
 * }
 * ```
 *
 * **Important Notes**:
 * - Actions are automatically registered with the HTTP server when the service is initialized
 * - Use `run()` for direct invocation (testing, internal calls, or remote services)
 * - Use `fetch()` for explicit HTTP requests (client-side, external services)
 * - Schema validation occurs automatically for all requests and responses
 * - Path parameters are automatically extracted from schema definitions
 * - Content-Type headers are automatically set based on schema types
 * - Actions can be disabled via the `disabled` option for maintenance or feature flags
 *
 * @stability 2
 */
export const $action = <TConfig extends RequestConfigSchema>(
	options: ActionDescriptorOptions<TConfig>,
): ActionDescriptor<TConfig> => {
	return createDescriptor(ActionDescriptor<TConfig>, options);
};

// ----------------------------------------------------------------------------------------------------------

export interface ActionDescriptorOptions<TConfig extends RequestConfigSchema>
	extends Omit<ServerRoute, "handler" | "path" | "schema" | "mapParams"> {
	/**
	 * Name of the action.
	 *
	 * - It will be used to generate the route path if `path` is not provided.
	 * - It will be used to generate the permission name if `security` is enabled.
	 */
	name?: string;

	/**
	 * Group actions together.
	 *
	 * - If not provided, the service name containing the route will be used.
	 * - It will be used as Tag for documentation purposes.
	 * - It will be used for permission name generation if `security` is enabled.
	 *
	 * @example
	 * ```ts
	 * // group = "MyController"
	 * class MyController {
	 * 	hello = $action({ handler: () => "Hello World" });
	 * }
	 *
	 * // group = "users"
	 * class MyOtherController {
	 *   group = "users";
	 *   a1 = $action({ handler: () => "Action 1", group: this.group });
	 *   a2 = $action({ handler: () => "Action 2", group: this.group });
	 * }
	 * ```
	 */
	group?: string;

	/**
	 * Pathname of the route. If not provided, property key is used.
	 */
	path?: string;

	/**
	 * The route method.
	 *
	 * - If not provided, it will be set to "GET" by default.
	 * - If not provider and a body is provided, it will be set to "POST".
	 *
	 * Wildcard methods are not supported for now. (e.g. "ALL", "ANY", etc.)
	 */
	method?: RouteMethod;

	/**
	 * The config schema of the route.
	 * - body: The request body schema.
	 * - params: Path variables schema.
	 * - query: The request query-params schema.
	 * - response: The response schema.
	 */
	schema?: TConfig;

	/**
	 * A short description of the action. Used for documentation purposes.
	 */
	description?: string;

	/**
	 * Disable the route. Useful with env variables do disable one specific route.
	 * Route won't be available in the API but can still be called locally!
	 */
	disabled?: boolean;

	/**
	 * Main route handler. This is where the route logic is implemented.
	 */
	handler: ServerActionHandler<TConfig>;
}

// ----------------------------------------------------------------------------------------------------------

const envSchema = t.object({
	SERVER_API_PREFIX: t.string({
		description: "Prefix for all API routes (e.g. $action).",
		default: "/api",
	}),
});

export class ActionDescriptor<
	TConfig extends RequestConfigSchema,
> extends Descriptor<ActionDescriptorOptions<TConfig>> {
	protected readonly log = $logger();
	protected readonly env = $env(envSchema);
	protected readonly httpClient = $inject(HttpClient);
	protected readonly serverProvider = $inject(ServerProvider);
	protected readonly serverRouterProvider = $inject(ServerRouterProvider);

	protected onInit() {
		if (this.options.disabled) {
			this.log.debug(
				`Action '${this.name}' is disabled. It won't be available in the API.`,
			);
			return;
		}
		this.serverRouterProvider.createRoute(this.route);
	}

	public get prefix() {
		return this.env.SERVER_API_PREFIX;
	}

	public get route(): ServerRoute {
		return {
			...this.options,
			method: this.method,
			path: `${this.prefix}${this.path}`,
		} as ServerRoute;
	}

	/**
	 * Returns the name of the action.
	 */
	public get name(): string {
		return this.options.name || this.config.propertyKey;
	}

	/**
	 * Returns the group of the action. (e.g. "orders", "admin", etc.)
	 */
	public get group(): string {
		return this.options.group || this.config.service.name;
	}

	/**
	 * Returns the HTTP method of the action.
	 */
	public get method(): RouteMethod {
		return this.options.method || (this.options.schema?.body ? "POST" : "GET");
	}

	/**
	 * Returns the path of the action.
	 *
	 * Path is prefixed by `/api` by default.
	 */
	public get path(): string {
		if (this.options.path) {
			return this.options.path;
		}

		let path = `/${this.name}`;

		if (this.options.schema?.params) {
			for (const [key] of Object.entries(
				this.options.schema.params.properties,
			)) {
				path += `/:${key}`;
			}
		}

		return path;
	}

	public get schema(): TConfig | undefined {
		return this.options.schema;
	}

	public getBodyContentType(): string | undefined {
		if (this.options.schema?.body) {
			// TODO: move to `alepha.server.multipart` module ?
			if (isMultipart(this.options)) {
				return "multipart/form-data";
			}

			if (this.options.schema.body.type === "string") {
				// if body is a string, we assume it's plain text
				return "text/plain";
			}

			if (
				this.options.schema.body.type === "object" ||
				this.options.schema.body.type === "array"
			) {
				// if body is an object or array, we assume it's JSON
				return "application/json";
			}
		}
	}

	/**
	 * Call the action handler directly.
	 * There is no HTTP layer involved.
	 */
	public async run(
		config: ClientRequestEntry<TConfig>,
		options: ClientRequestOptions = {}, // most of the options are ignored here
	): Promise<ClientRequestResponse<TConfig>> {
		const handler = this.options.handler;
		const {
			body,
			params = {},
			query = {},
			headers = {},
		} = config as ClientRequestEntryContainer<RequestConfigSchema>;
		const reply = new ServerReply();
		const method = this.method;

		// we use localhost as the base URL for the action
		const url = new URL(`http://localhost${this.path ?? ""}`);

		const serverActionRequest: Partial<ServerRequest> = {
			method,
			url,
			body,
			params,
			query,
			headers,
			reply,
			metadata: {},
			raw: {},
		};

		await this.alepha.emit("action:onRequest", {
			action: this,
			request: serverActionRequest as ServerRequest,
			options,
		});

		if (serverActionRequest.reply?.body) {
			return serverActionRequest.reply.body as ClientRequestResponse<TConfig>;
		}

		this.serverRouterProvider.validateRequest(
			this.options,
			serverActionRequest as ServerRequest,
		);

		let response = await handler(
			serverActionRequest as ServerActionRequest<TConfig>,
		);

		// we validate response just to remove undeclared properties from response
		if (
			this.options.schema?.response &&
			// skip validation if response is expected as file
			!isTypeFile(this.options.schema.response)
		) {
			response = this.alepha.parse<any>(
				this.options.schema?.response,
				response,
			);
		}

		await this.alepha.emit("action:onResponse", {
			action: this,
			request: serverActionRequest as ServerRequest,
			options,
			response,
		});

		return response;
	}

	/**
	 * Works like `run`, but always fetches (http request) the route.
	 */
	public fetch(
		config?: ClientRequestEntry<TConfig>,
		options?: ClientRequestOptions,
	): Promise<FetchResponse<ClientRequestResponse<TConfig>>> {
		return this.httpClient.fetchAction({
			host: this.serverProvider.hostname, // that's the trick, we just use the server hostname
			action: this,
			config,
			options,
		});
	}
}

$action[KIND] = ActionDescriptor;

// ----------------------------------------------------------------------------------------------------------

export type ClientRequestEntry<
	TConfig extends RequestConfigSchema,
	T = ClientRequestEntryContainer<TConfig>,
> = {
	[K in keyof T as T[K] extends undefined ? never : K]: T[K];
};

export type ClientRequestEntryContainer<TConfig extends RequestConfigSchema> = {
	body: TConfig["body"] extends TSchema ? Static<TConfig["body"]> : undefined;

	params: TConfig["params"] extends TSchema
		? Static<TConfig["params"]>
		: undefined;

	headers?: TConfig["headers"] extends TSchema
		? Static<TConfig["headers"]>
		: undefined;

	query?: TConfig["query"] extends TSchema
		? Partial<Static<TConfig["query"]>>
		: undefined;
};

export interface ClientRequestOptions extends FetchOptions {
	/**
	 * Standard request fetch options.
	 */
	request?: RequestInit;
}

export type ClientRequestResponse<TConfig extends RequestConfigSchema> =
	TConfig["response"] extends TSchema ? Static<TConfig["response"]> : any;

/**
 * Specific handler for server actions.
 */
export type ServerActionHandler<
	TConfig extends RequestConfigSchema = RequestConfigSchema,
> = (
	request: ServerActionRequest<TConfig>,
) => Async<ServerResponseBody<TConfig>>;

/**
 * Server Action Request Interface
 *
 * Can be extended with module augmentation to add custom properties (like `user` in Server Security).
 *
 * This is NOT Server Request, but a specific type for actions.
 */
export interface ServerActionRequest<TConfig extends RequestConfigSchema>
	extends ServerRequest<TConfig> {}
