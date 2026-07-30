import type { ApiKeyController } from "alepha/api/keys";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";
import type { IdentityController } from "@/api/controllers/IdentityController.ts";
import type { InvitationController } from "@/api/controllers/InvitationController.ts";
import type { SessionController } from "@/api/controllers/SessionController.ts";
import type { UserController } from "@/api/controllers/UserController.ts";

export class MeRouter {
  sessionApi = $client<SessionController>();
  identityApi = $client<IdentityController>();
  userApi = $client<UserController>();
  apiKeyApi = $client<ApiKeyController>();
  invitationApi = $client<InvitationController>();

  me = $page({
    path: "/auth/profile",
    lazy: () => import("./MeLayout.tsx"),
  });

  identities = $page({
    parent: this.me,
    path: "/identities",
    lazy: () => import("../MyIdentities.tsx"),
    loader: async () => {
      return {
        identities: await this.identityApi.getMyIdentities(),
      };
    },
  });

  profile = $page({
    parent: this.me,
    path: "/",
    lazy: () => import("../MyProfile.tsx"),
    loader: async () => {
      const [user, identities] = await Promise.all([
        this.userApi.me(),
        this.identityApi.getMyIdentities(),
      ]);
      return {
        user,
        identities,
      };
    },
  });

  sessions = $page({
    parent: this.me,
    path: "/sessions",
    lazy: () => import("../MySessions.tsx"),
    loader: async () => {
      return {
        sessions: await this.sessionApi.getMySessions(),
      };
    },
  });

  apiKeys = $page({
    parent: this.me,
    path: "/api-keys",
    lazy: () => import("../MyApiKeys.tsx"),
    loader: async () => {
      return {
        apiKeys: await this.apiKeyApi.listApiKeys(),
      };
    },
  });

  invitations = $page({
    parent: this.me,
    path: "/invitations",
    lazy: () => import("../MyInvitations.tsx"),
    loader: async () => {
      return {
        invitations: await this.invitationApi.listMyInvitations(),
      };
    },
  });

  myPetitions = $page({
    parent: this.me,
    path: "/petitions",
    lazy: () => import("../petitions/MyPetitions.tsx"),
  });

  connections = $page({
    parent: this.me,
    path: "/connections",
    lazy: () => import("../MyConnections.tsx"),
    loader: async () => {
      return {
        connections: await this.sessionApi.getMyConnections(),
      };
    },
  });
}
