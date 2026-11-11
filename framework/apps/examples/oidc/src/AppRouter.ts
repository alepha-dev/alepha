import { z } from "alepha";
import { $page } from "alepha/react/router";
import { $secure } from "alepha/security";

/**
 * Three pages: a public one, the sign-in page a guarded page sends an
 * anonymous visitor to, and a guarded one.
 */
export class AppRouter {
  home = $page({
    path: "/",
    head: { title: "OIDC example" },
    lazy: () => import("./pages/Home.tsx"),
  });

  /**
   * The conventional `login` route: `$secure` on a page redirects an
   * anonymous visitor here, with the blocked URL as `?redirect=`.
   */
  login = $page({
    name: "login",
    path: "/login",
    head: { title: "Sign in" },
    schema: {
      query: z.object({ redirect: z.text({ size: "long" }).optional() }),
    },
    loader: ({ query }) => ({ redirect: query.redirect ?? "/profile" }),
    lazy: () => import("./pages/Login.tsx"),
  });

  profile = $page({
    path: "/profile",
    head: { title: "Profile" },
    use: [$secure()],
    lazy: () => import("./pages/Profile.tsx"),
  });
}
