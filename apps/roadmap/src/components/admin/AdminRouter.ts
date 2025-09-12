import { $page } from "@alepha/react";

export class AdminRouter {
	admin = $page({
		path: "/admin",
		lazy: () => import("./AdminLayout.tsx"),
	});

	users = $page({
		parent: this.admin,
		path: "/users",
		lazy: () => import("./AdminUsers.tsx"),
	});

	projects = $page({
		parent: this.admin,
		path: "/projects",
		lazy: () => import("./AdminProjects.tsx"),
	});
}
