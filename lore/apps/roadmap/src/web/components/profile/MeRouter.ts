import { $page } from "@alepha/react/router";
import { $client } from "alepha/server/links";
import type { CharacterController } from "../../../api/controllers/CharacterController.ts";
import type { IdentityController } from "../../../api/controllers/IdentityController.ts";
import type { InvitationController } from "../../../api/controllers/InvitationController.ts";
import type { McpApiKeyController } from "../../../api/controllers/McpApiKeyController.ts";
import type { SessionController } from "../../../api/controllers/SessionController.ts";
import type { UserController } from "../../../api/controllers/UserController.ts";

export class MeRouter {
  sessionApi = $client<SessionController>();
  characterApi = $client<CharacterController>();
  identityApi = $client<IdentityController>();
  invitationApi = $client<InvitationController>();
  userApi = $client<UserController>();
  mcpApiKeyApi = $client<McpApiKeyController>();

  me = $page({
    path: "/me",
    lazy: () => import("././MeLayout.jsx"),
  });

  characters = $page({
    parent: this.me,
    path: "/characters",
    lazy: () => import("./MyCharacters.jsx"),
    loader: async () => {
      return {
        characters: await this.characterApi.getMyCharacters(),
      };
    },
  });

  identities = $page({
    parent: this.me,
    path: "/identities",
    lazy: () => import("./MyIdentities.jsx"),
    loader: async () => {
      return {
        identities: await this.identityApi.getMyIdentities(),
      };
    },
  });

  invitations = $page({
    parent: this.me,
    path: "/invitations",
    lazy: () => import("./MyInvitations.jsx"),
    loader: async () => {
      return {
        invitations: await this.invitationApi.getMyInvitations(),
      };
    },
  });

  profile = $page({
    parent: this.me,
    path: "/",
    lazy: () => import("./MyProfile.jsx"),
    loader: async () => {
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
    lazy: () => import("./MySessions.jsx"),
    loader: async () => {
      return {
        sessions: await this.sessionApi.getMySessions(),
      };
    },
  });

  apiKeys = $page({
    parent: this.me,
    path: "/api-keys",
    lazy: () => import("./MyApiKeys.jsx"),
    loader: async () => {
      return {
        apiKeys: await this.mcpApiKeyApi.listApiKeys(),
      };
    },
  });
}
