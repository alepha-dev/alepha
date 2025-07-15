import { __bind, type Alepha, type Module } from "@alepha/core";
import { AlephaServer, type ServerRequest } from "@alepha/server";
import { AlephaServerCache } from "@alepha/server-cache";
import { AlephaServerLinks } from "@alepha/server-links";
import { $page } from "./descriptors/$page.ts";
import {
	PageDescriptorProvider,
	type PageReactContext,
	type PageRequest,
	type RouterState,
} from "./providers/PageDescriptorProvider.ts";
import type { ReactHydrationState } from "./providers/ReactBrowserProvider.ts";
import { ReactServerProvider } from "./providers/ReactServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./index.shared.ts";
export * from "./providers/PageDescriptorProvider.ts";
export * from "./providers/ReactBrowserProvider.ts";
export * from "./providers/ReactServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
	interface Hooks {
		"react:router:createLayers": {
			request: ServerRequest;
			context: PageRequest;
			layers: PageRequest[];
		};
		"react:server:render:begin": {
			request?: ServerRequest;
			context: PageRequest;
		};
		"react:server:render:end": {
			request?: ServerRequest;
			context: PageRequest;
			state: RouterState;
			html: string;
		};
		"react:browser:render": {
			state: RouterState;
			context: PageReactContext;
			hydration?: ReactHydrationState;
		};
		"react:transition:begin": {
			state: RouterState;
			context: PageReactContext;
		};
		"react:transition:success": {
			state: RouterState;
			context: PageReactContext;
		};
		"react:transition:error": {
			error: Error;
			state: RouterState;
			context: PageReactContext;
		};
		"react:transition:end": {
			state: RouterState;
			context: PageReactContext;
		};
	}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Provides full-stack React development with declarative routing, server-side rendering, and client-side hydration.
 *
 * The React module enables building modern React applications using the `$page` descriptor on class properties.
 * It delivers seamless server-side rendering, automatic code splitting, and client-side navigation with full
 * type safety and schema validation for route parameters and data.
 *
 * **Key Features:**
 * - Declarative page definition with `$page` descriptor
 * - Server-side rendering (SSR) with automatic hydration
 * - Type-safe routing with parameter validation
 * - Schema-based data resolution and validation
 * - SEO-friendly meta tag management
 * - Automatic code splitting and lazy loading
 * - Client-side navigation with browser history
 *
 * **Basic Usage:**
 * ```ts
 * import { Alepha, run, t } from "alepha";
 * import { AlephaReact, $page } from "alepha/react";
 *
 * class AppRoutes {
 *   // Home page
 *   home = $page({
 *     path: "/",
 *     component: () => (
 *       <div>
 *         <h1>Welcome to Alepha</h1>
 *         <p>Build amazing React applications!</p>
 *       </div>
 *     ),
 *   });
 *
 *   // About page with meta tags
 *   about = $page({
 *     path: "/about",
 *     head: {
 *       title: "About Us",
 *       description: "Learn more about our mission",
 *     },
 *     component: () => (
 *       <div>
 *         <h1>About Us</h1>
 *         <p>Learn more about our mission.</p>
 *       </div>
 *     ),
 *   });
 * }
 *
 * const alepha = Alepha.create()
 *   .with(AlephaReact)
 *   .with(AppRoutes);
 *
 * run(alepha);
 * ```
 *
 * **Dynamic Routes with Parameters:**
 * ```tsx
 * class UserRoutes {
 *   userProfile = $page({
 *     path: "/users/:id",
 *     schema: {
 *       params: t.object({
 *         id: t.string(),
 *       }),
 *     },
 *     resolve: async ({ params }) => {
 *       // Fetch user data server-side
 *       const user = await getUserById(params.id);
 *       return { user };
 *     },
 *     head: ({ user }) => ({
 *       title: `${user.name} - Profile`,
 *       description: `View ${user.name}'s profile`,
 *     }),
 *     component: ({ user }) => (
 *       <div>
 *         <h1>{user.name}</h1>
 *         <p>Email: {user.email}</p>
 *       </div>
 *     ),
 *   });
 *
 *   userSettings = $page({
 *     path: "/users/:id/settings",
 *     schema: {
 *       params: t.object({
 *         id: t.string(),
 *       }),
 *     },
 *     component: ({ params }) => (
 *       <UserSettings userId={params.id} />
 *     ),
 *   });
 * }
 * ```
 *
 * **Static Generation:**
 * ```tsx
 * class BlogRoutes {
 *   blogPost = $page({
 *     path: "/blog/:slug",
 *     schema: {
 *       params: t.object({
 *         slug: t.string(),
 *       }),
 *     },
 *     static: {
 *       entries: [
 *         { params: { slug: "getting-started" } },
 *         { params: { slug: "advanced-features" } },
 *         { params: { slug: "deployment" } },
 *       ],
 *     },
 *     resolve: ({ params }) => {
 *       const post = getBlogPost(params.slug);
 *       return { post };
 *     },
 *     component: ({ post }) => (
 *       <article>
 *         <h1>{post.title}</h1>
 *         <div>{post.content}</div>
 *       </article>
 *     ),
 *   });
 * }
 * ```
 *
 * @see {@link $page}
 * @module alepha.react
 */
export class AlephaReact implements Module {
	public readonly name = "alepha.react";
	public readonly $services = (alepha: Alepha) =>
		alepha
			.with(AlephaServer)
			.with(AlephaServerCache)
			.with(AlephaServerLinks)
			.with(ReactServerProvider)
			.with(PageDescriptorProvider);
}

__bind($page, AlephaReact);
