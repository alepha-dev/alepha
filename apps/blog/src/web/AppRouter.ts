import { $uiAuth } from "@alepha/ui/auth";
import { $page } from "alepha/react/router";

export class AppRouter {
  uiAuth = $uiAuth();

  layout = $page({
    lazy: () => import("./components/Layout.tsx"),
    children: () => [
      this.home,
      this.posts,
      this.postEditor,
      this.media,
      this.pages,
      this.comments,
      this.themes,
      this.settings,
      this.users,
      this.userProfile,
      this.sessions,
      this.identity,
      this.roles,
    ],
  });

  home = $page({
    path: "/",
    label: "Dashboard",
    lazy: () => import("./components/Home.tsx"),
  });

  posts = $page({
    path: "/posts",
    label: "Posts",
    lazy: () => import("./components/Posts.tsx"),
  });

  postEditor = $page({
    path: "/posts/new",
    label: "New Post",
    lazy: () => import("./components/PostEditor.tsx"),
  });

  media = $page({
    path: "/media",
    label: "Media Library",
    lazy: () => import("./components/Media.tsx"),
  });

  pages = $page({
    path: "/pages",
    label: "Pages",
    lazy: () => import("./components/Pages.tsx"),
  });

  comments = $page({
    path: "/comments",
    label: "Comments",
    lazy: () => import("./components/Comments.tsx"),
  });

  themes = $page({
    path: "/themes",
    label: "Themes",
    lazy: () => import("./components/Themes.tsx"),
  });

  settings = $page({
    path: "/settings",
    label: "Settings",
    lazy: () => import("./components/Settings.tsx"),
  });

  users = $page({
    path: "/users",
    label: "Users",
    lazy: () => import("./components/Users.tsx"),
  });

  sessions = $page({
    path: "/users/sessions",
    label: "Sessions",
    lazy: () => import("./components/Sessions.tsx"),
  });

  identity = $page({
    path: "/users/identity",
    label: "Login & Identity",
    lazy: () => import("./components/Identity.tsx"),
  });

  roles = $page({
    path: "/users/roles",
    label: "Roles",
    lazy: () => import("./components/Roles.tsx"),
  });

  userProfile = $page({
    path: "/users/:userId",
    label: "Profile",
    lazy: () => import("./components/UserProfile.tsx"),
    children: () => [
      this.userProfileOverview,
      this.userProfilePosts,
      this.userProfileActivity,
    ],
  });

  userProfileOverview = $page({
    path: "/",
    label: "Overview",
    lazy: () => import("./components/UserProfileOverview.tsx"),
  });

  userProfilePosts = $page({
    path: "/posts",
    label: "Posts",
    lazy: () => import("./components/UserProfilePosts.tsx"),
  });

  userProfileActivity = $page({
    path: "/activity",
    label: "Activity",
    lazy: () => import("./components/UserProfileActivity.tsx"),
  });
}
