import { $uiAdmin } from "@alepha/ui/admin";
import { $uiAuth } from "@alepha/ui/auth";
import { IconArticle, IconPlus } from "@tabler/icons-react";
import { t } from "alepha";
import { $head } from "alepha/react/head";
import { $page, Redirection } from "alepha/react/router";
import { HttpError } from "alepha/server";
import { $etag } from "alepha/server/etag";
import { $client } from "alepha/server/links";
import type { PostController } from "@/api/controllers/PostController.ts";

export class AppRouter {
  postApi = $client<PostController>();

  uiAuth = $uiAuth();
  uiAdmin = $uiAdmin((adminRouter) => ({
    sidebarProps: {
      items: [
        ...adminRouter.getDefaultSidebarItems(),
        {
          type: "section" as const,
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
    },
    appBarProps: {
      items: adminRouter.getDefaultAppBarItems(),
    },
  }));

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
