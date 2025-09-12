import { $page } from "@alepha/react";
import { $client } from "@alepha/server-links";
import type { CharacterApi } from "../../api/CharacterApi.ts";
import type { IdentityApi } from "../../api/IdentityApi.ts";
import type { InvitationApi } from "../../api/InvitationApi.ts";
import type { SessionApi } from "../../api/SessionApi.ts";
import type { UserApi } from "../../api/UserApi.ts";

export class MeRouter {
	sessionApi = $client<SessionApi>();
	characterApi = $client<CharacterApi>();
	identityApi = $client<IdentityApi>();
	invitationApi = $client<InvitationApi>();
	userApi = $client<UserApi>();

	me = $page({
		path: "/me",
		lazy: () => import("././MeLayout.tsx"),
	});

	characters = $page({
		parent: this.me,
		path: "/characters",
		lazy: () => import("./MyCharacters.tsx"),
		resolve: async () => {
			return {
				characters: await this.characterApi.getMyCharacters(),
			};
		},
	});

	identities = $page({
		parent: this.me,
		path: "/identities",
		lazy: () => import("./MyIdentities.tsx"),
		resolve: async () => {
			return {
				identities: await this.identityApi.getMyIdentities(),
			};
		},
	});

	invitations = $page({
		parent: this.me,
		path: "/invitations",
		lazy: () => import("./MyInvitations.tsx"),
		resolve: async () => {
			return {
				invitations: await this.invitationApi.getMyInvitations(),
			};
		},
	});

	profile = $page({
		parent: this.me,
		path: "/",
		lazy: () => import("./MyProfile.tsx"),
		resolve: async () => {
			const [user, characters, identities] = await Promise.all([
				this.userApi.me(),
				this.characterApi.getMyCharacters(),
				this.identityApi.getMyIdentities(),
			]);
			return {
				user,
				characters,
				identities,
			};
		},
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
		animation: {
			enter: "fadeInUpLight",
			exit: "fadeOutDownLight",
		},
	});
}
