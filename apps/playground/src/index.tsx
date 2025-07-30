import { Alepha, run } from "@alepha/core";
import { $page, Link } from "@alepha/react";
import Hello from "./Hello.tsx";
import { I18n } from "./I18n.ts";

class App {
	root = $page({
		path: "/",
		component: Hello,
	});

	page2 = $page({
		path: "/page2",
		component: () => (
			<div>
				<Link to={"/"}>Page1</Link>
			</div>
		),
	});
}

const alepha = Alepha.create();

alepha.with(I18n);
alepha.with(App);

if (import.meta.env.SSR) {
	const { AlephaServerCookies } = await import("@alepha/server-cookies");
	alepha.with(AlephaServerCookies);
	alepha.with(await import("./Api.ts"));
}

run(alepha);
