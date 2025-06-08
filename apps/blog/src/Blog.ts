import { $page } from "@alepha/react";

export class Blog {
	hello = $page({
		head: {
			title: "Alepha Blog",
		},
		lazy: () => import("./components/hello.tsx"),
	});
}
