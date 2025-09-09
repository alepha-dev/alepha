import { Alepha, run } from "@alepha/core";
import { $page } from "@alepha/react";
import { AlephaReactHead } from "@alepha/react-head";
import App from "./App.tsx";

class AppRouter {
	root = $page({
		path: "/",
		component: App,
	});
}
const alepha = Alepha.create().with(AlephaReactHead).with(AppRouter);

run(alepha);
