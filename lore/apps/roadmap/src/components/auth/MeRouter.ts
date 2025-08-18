import { $page } from "@alepha/react";
import { $client } from "@alepha/server-links";
import type { SessionApi } from "../../api/SessionApi.ts";

export class MeRouter {
	sessionApi = $client<SessionApi>();

	me = $page({
		path: "/me",
		lazy: () => import("././MeLayout.tsx"),
	});

	characters = $page({
		parent: this.me,
		path: "/characters",
		lazy: () => import("./MyCharacters.tsx"),
	});

	profile = $page({
		parent: this.me,
		path: "/",
		lazy: () => import("./MyProfile.tsx"),
	});

	sessions = $page({
		parent: this.me,
		path: "/sessions",
		lazy: () => import("./MySessions.tsx"),
		resolve: async () => {
			return {
				sessions: await this.sessionApi.getMySessions(),
			};
		},
	});
}
