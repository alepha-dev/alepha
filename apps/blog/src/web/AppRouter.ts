import { $ui } from "@alepha/ui";
import { $uiAdmin } from "@alepha/ui/admin";
import { $uiAuth } from "@alepha/ui/auth";
import {
  IconArticle,
  IconCategory2,
  IconDashboard,
  IconMessage,
  IconSettings,
} from "@tabler/icons-react";
import { t } from "alepha";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";
import type { AdminCommentController } from "../api/controllers/AdminCommentController.ts";
import type { AdminPostController } from "../api/controllers/AdminPostController.ts";
import type { AdminSystemController } from "../api/controllers/AdminSystemController.ts";
import type { CategoryController } from "../api/controllers/CategoryController.ts";
import type { CommentController } from "../api/controllers/CommentController.ts";
import type { PostController } from "../api/controllers/PostController.ts";

export class AppRouter {
  protected readonly postCtrl = $client<PostController>();
  protected readonly adminPostCtrl = $client<AdminPostController>();
  protected readonly categoryCtrl = $client<CategoryController>();
  protected readonly commentCtrl = $client<CommentController>();
  protected readonly adminCommentCtrl = $client<AdminCommentController>();
  protected readonly adminSystemCtrl = $client<AdminSystemController>();

  ui = $ui();

  // ─────────────────────────────────────────────────────────────────────────────
  // Auth (pre-built)
  // ─────────────────────────────────────────────────────────────────────────────

  uiAuth = $uiAuth();

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin (pre-built + custom blog pages)
  // ─────────────────────────────────────────────────────────────────────────────

  uiAdmin = $uiAdmin((admin) => ({
    sidebarResizable: true,
    navbarFooter: " ",
    navbarHeader: " ",
    layout: "alt",
    footerHeight: 36,
    sidebarProps: {
      items: [
        { label: "Dashboard", icon: IconDashboard, href: "/admin" },
        {
          type: "section" as const,
          label: "Content",
          children: [
            { label: "Posts", icon: IconArticle, href: "/admin/posts" },
            {
              label: "Comments",
              icon: IconMessage,
              href: "/admin/comments",
            },
            {
              label: "Categories",
              icon: IconCategory2,
              href: "/admin/categories",
            },
          ],
        },
        { label: "Seed", icon: IconSettings, href: "/admin/system" },
        ...admin.getDefaultSidebarItems(),
      ],
    },
  }));

  adminDashboard = $page({
    parent: this.uiAdmin.adminLayout,
    path: "/",
    label: "Dashboard",
    icon: IconDashboard,
    loader: async () => {
      const stats = await this.adminPostCtrl.getDashboardStats({});
      return { stats };
    },
    lazy: () => import("./admin/AdminDashboard.tsx"),
  });

  adminPosts = $page({
    parent: this.uiAdmin.adminLayout,
    path: "/posts",
    label: "Posts",
    icon: IconArticle,
    loader: async () => {
      const res = (await this.adminPostCtrl.findPosts({
        query: { page: 0, size: 15 } as any,
      })) as any;
      return {
        initialPosts: res.content,
        initialTotal: res.page.totalElements || 0,
      };
    },
    lazy: () => import("./admin/AdminPosts.tsx"),
  });

  adminPostNew = $page({
    parent: this.uiAdmin.adminLayout,
    path: "/posts/new",
    label: "New Post",
    loader: async () => {
      const categories = await this.categoryCtrl.listCategories({});
      return { categories };
    },
    lazy: () => import("./admin/AdminPostEditor.tsx"),
  });

  adminPostEdit = $page({
    parent: this.uiAdmin.adminLayout,
    path: "/posts/:id/edit",
    label: "Edit Post",
    schema: { params: t.object({ id: t.uuid() }) },
    loader: async ({ params }) => {
      const [post, categories] = await Promise.all([
        this.adminPostCtrl.getPost({ params: { id: params.id } }),
        this.categoryCtrl.listCategories({}),
      ]);
      return { post, categories };
    },
    lazy: () => import("./admin/AdminPostEditor.tsx"),
  });

  adminComments = $page({
    parent: this.uiAdmin.adminLayout,
    path: "/comments",
    label: "Comments",
    icon: IconMessage,
    loader: async () => {
      const res = (await this.adminCommentCtrl.findComments({
        query: { page: 0, size: 20 } as any,
      })) as any;
      return {
        initialComments: res.content,
        initialTotal: res.page.totalElements || 0,
      };
    },
    lazy: () => import("./admin/AdminComments.tsx"),
  });

  adminCategories = $page({
    parent: this.uiAdmin.adminLayout,
    path: "/categories",
    label: "Categories",
    icon: IconCategory2,
    loader: async () => {
      const initialCategories = await this.categoryCtrl.listCategories({});
      return { initialCategories };
    },
    lazy: () => import("./admin/AdminCategories.tsx"),
  });

  adminSystem = $page({
    parent: this.uiAdmin.adminLayout,
    path: "/system",
    label: "System",
    icon: IconSettings,
    lazy: () => import("./admin/AdminSystem.tsx"),
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Blog
  // ─────────────────────────────────────────────────────────────────────────────

  blogLayout = $page({
    parent: this.ui.root,
    lazy: () => import("./blog/BlogLayout.tsx"),
    children: () => [
      this.blogHome,
      this.blogPost,
      this.blogAuthor,
      this.blogCategories,
      this.blogCategory,
    ],
  });

  blogHome = $page({
    path: "/",
    label: "Home",
    loader: async () => {
      const [featured, postsRes, categories] = await Promise.all([
        this.postCtrl.getFeaturedPosts({}),
        this.postCtrl.listPublishedPosts({ query: { page: 0, size: 10 } }),
        this.categoryCtrl.listCategories({}),
      ]);
      const page = postsRes as any;
      return {
        featured,
        posts: page.content,
        categories,
        hasMore: !page.page.isLast,
      };
    },
    lazy: () => import("./blog/BlogHome.tsx"),
  });

  blogPost = $page({
    path: "/post/:slug",
    label: "Post",
    schema: { params: t.object({ slug: t.text() }) },
    loader: async ({ params }) => {
      const post = (await this.postCtrl.getPostBySlug({
        params: { slug: params.slug },
      })) as any;
      const commentsRes = (await this.commentCtrl.listComments({
        params: { postId: post.id },
        query: { size: 50 },
      })) as any;
      return { post, comments: commentsRes.content };
    },
    lazy: () => import("./blog/BlogPost.tsx"),
  });

  blogAuthor = $page({
    path: "/author/:id",
    label: "Author",
    schema: { params: t.object({ id: t.uuid() }) },
    loader: async ({ params }) => {
      const res = (await this.postCtrl.listPublishedPosts({
        query: { authorId: params.id, size: 50 },
      })) as any;
      return { posts: res.content };
    },
    lazy: () => import("./blog/BlogAuthor.tsx"),
  });

  blogCategories = $page({
    path: "/categories",
    label: "Categories",
    loader: async () => {
      const categories = await this.categoryCtrl.listCategories({});
      return { categories };
    },
    lazy: () => import("./blog/BlogCategories.tsx"),
  });

  blogCategory = $page({
    path: "/category/:slug",
    label: "Category",
    schema: { params: t.object({ slug: t.text() }) },
    loader: async ({ params }) => {
      const allCategories = (await this.categoryCtrl.listCategories(
        {},
      )) as any[];
      const category = allCategories.find((c: any) => c.slug === params.slug);
      let posts: any[] = [];
      if (category) {
        const res = (await this.postCtrl.listPublishedPosts({
          query: { categoryId: category.id, size: 50 },
        })) as any;
        posts = res.content;
      }
      return { category: category || null, categories: allCategories, posts };
    },
    lazy: () => import("./blog/BlogCategory.tsx"),
  });
}
