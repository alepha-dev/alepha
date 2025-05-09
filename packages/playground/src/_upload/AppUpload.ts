import { $page } from "@alepha/react";

export class AppUpload {
	upload = $page({
		path: "/upload",
		lazy: () => import("./components/Upload.tsx"),
	});
}
