import { $page } from "@alepha/react";
import App from "./App.tsx";

export class AppRouter {
	root = $page({
		path: "/",
		component: App,
	});
}
