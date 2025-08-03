import { $inject } from "@alepha/core";
import { $page } from "@alepha/react";
import { $head } from "@alepha/react-head";
import { I18n } from "./services/I18n.ts";
import { Theme } from "./services/Theme.ts";

export class App {
	i18n = $inject(I18n);
	theme = $inject(Theme);

	head = $head(() => {
		return {
			title: "Roadmap",
			bodyAttributes: {
				class: this.theme.getColorSchemeClass(),
			},
		};
	});

	home = $page({
		path: "/",
		lazy: () => import("./components/Home.tsx"),
	});
}
