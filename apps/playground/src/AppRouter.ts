import { $page } from "@alepha/react";
import Home from "./components/Home.tsx";

export class AppRouter {
	root = $page({
		path: "/",
		component: Home,
	});
}
