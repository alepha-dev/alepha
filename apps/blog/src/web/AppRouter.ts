import { $uiAdmin } from "@alepha/ui/admin";
import { AdminAuditRouter } from "@alepha/ui/admin-audits";
import { AdminBillingRouter } from "@alepha/ui/admin-billing";
import { AdminFileRouter } from "@alepha/ui/admin-files";
import { AdminJobRouter } from "@alepha/ui/admin-jobs";
import { AdminApiKeyRouter } from "@alepha/ui/admin-keys";
import { AdminNotificationRouter } from "@alepha/ui/admin-notifications";
import { AdminParameterRouter } from "@alepha/ui/admin-parameters";
import { AdminSessionRouter } from "@alepha/ui/admin-sessions";
import { AdminUserRouter } from "@alepha/ui/admin-users";
import { $uiAuth } from "@alepha/ui/auth";
import {
  IconArticle,
  IconCreditCard,
  IconLockPassword,
  IconPlus,
} from "@tabler/icons-react";
import { $inject, t } from "alepha";
import { $head } from "alepha/react/head";
import { $page, Redirection } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { $client } from "alepha/server/links";
import type { PostController } from "@/api/controllers/PostController.ts";

export class AppRouter {
  postApi = $client<PostController>();

  // ── Admin Domain Routers ──────────────────────────
  protected users = $inject(AdminUserRouter);
  protected sessions = $inject(AdminSessionRouter);
  protected audits = $inject(AdminAuditRouter);
  protected files = $inject(AdminFileRouter);
  protected parameters = $inject(AdminParameterRouter);
  protected jobs = $inject(AdminJobRouter);
  protected apiKeys = $inject(AdminApiKeyRouter);
  protected notifications = $inject(AdminNotificationRouter);
  protected billing = $inject(AdminBillingRouter);

  uiAuth = $uiAuth();
  uiAdmin = $uiAdmin({
    pages: [
      this.users.adminUsers,
      this.sessions.adminSessions,
      this.audits.adminAudits,
      this.files.adminFiles,
      this.parameters.adminParameters,
      this.jobs.adminJobs,
      this.apiKeys.adminApiKeys,
      this.notifications.adminNotifications,
      this.billing.adminBilling,
    ],
    sidebarItems: [
      {
        label: "Security",
        children: [
          {
            label: "Identity",
            icon: IconLockPassword,
            children: [
              this.users.adminUsers,
              this.sessions.adminSessions,
              this.apiKeys.adminApiKeys,
            ],
          },
          this.audits.adminAudits,
        ],
      },
      {
        label: "System",
        children: [
          this.files.adminFiles,
          this.jobs.adminJobs,
          this.notifications.adminNotifications,
          this.parameters.adminParameters,
        ],
      },
      {
        label: "Commerce",
        icon: IconCreditCard,
        children: [this.billing.adminBilling],
      },
      {
        label: "Content",
        children: [
          {
            label: "Posts",
            icon: IconArticle,
            href: "/admin/posts",
          },
          {
            label: "New Post",
            icon: IconPlus,
            href: "/admin/posts/new",
          },
        ],
      },
    ],
  });

  protected publicCache = $etag({
    control: { public: true, sMaxAge: 900, staleWhileRevalidate: 60 },
  });

  head = $head(() => ({
    title: "Alepha Blog",
    titleSeparator: " - ",
    description: "Thoughts on building modern TypeScript frameworks",
    link: [{ rel: "icon", href: "/favicon.png", type: "image/png" }],
    meta: [
      {
        name: "description",
        content: "Thoughts on building modern TypeScript frameworks",
      },
    ],
  }));

  layout = $page({
    children: () => [this.home, this.post, this.tag],
    lazy: () => import("./components/Layout.tsx"),
    errorHandler: (error, state) => {
      if (HttpError.is(error, 401) && state.url.pathname !== "/auth/login") {
        return new Redirection(`/auth/login?r=${state.url.pathname}`);
      }
    },
  });

  home = $page({
    path: "/",
    use: [this.publicCache],
    loader: async () => {
      const posts = await this.postApi.listPublished();
      return { posts };
    },
    lazy: () => import("./components/HomePage.tsx"),
  });

  post = $page({
    path: "/posts/:slug",
    schema: { params: t.object({ slug: t.shortText() }) },
    use: [this.publicCache],
    loader: async ({ params }) => {
      const post = await this.postApi.getBySlug({ params });
      return { post };
    },
    lazy: () => import("./components/PostPage.tsx"),
  });

  tag = $page({
    path: "/tags/:tag",
    schema: { params: t.object({ tag: t.shortText() }) },
    use: [this.publicCache],
    loader: async ({ params }) => {
      const posts = await this.postApi.listPublished({
        query: { tag: params.tag },
      });
      return { posts, tag: params.tag };
    },
    lazy: () => import("./components/TagPage.tsx"),
  });

  // Admin pages — parented to adminLayout, inherits $secure middleware
  adminPosts = $page({
    parent: this.uiAdmin.adminLayout,
    path: "/posts",
    label: "Posts",
    head: { title: "Posts" },
    lazy: () => import("./admin/AdminPosts.tsx"),
  });

  adminPostCreate = $page({
    parent: this.uiAdmin.adminLayout,
    path: "/posts/new",
    label: "New Post",
    head: { title: "New Post" },
    lazy: () => import("./admin/AdminPostCreate.tsx"),
  });

  adminPostEdit = $page({
    parent: this.uiAdmin.adminLayout,
    path: "/posts/:slug/edit",
    label: "Edit Post",
    head: { title: "Edit Post" },
    schema: { params: t.object({ slug: t.shortText() }) },
    lazy: () => import("./admin/AdminPostEdit.tsx"),
  });
}
