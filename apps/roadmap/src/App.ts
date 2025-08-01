import { $page } from "@alepha/react";
import { $head } from "@alepha/react-head";
import Home from "./Home.tsx";

export class App {
	head = $head({
		title: "Roadmap",
		meta: [
			{
				name: "description",
				content: "Roadmap application built with Alepha.",
			},
			{
				name: "theme-color",
				content: "#ffffff",
			},
			{
				name: "author",
				content: "Alepha Team",
			},
		],
	});

	home = $page({
		path: "/",
		component: Home,
	});
}
