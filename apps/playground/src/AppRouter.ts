import { $page } from "@alepha/react/router";
import { AdminRouter } from "@alepha/ui/admin";
import { AuthRouter } from "@alepha/ui/auth";
import { $inject } from "alepha";
import Home from "./Home.tsx";
import { Layout } from "./Layout.tsx";

export class AppRouter {
  authRouter = $inject(AuthRouter);
  adminRouter = $inject(AdminRouter);

  auth = $page({
    path: "/auth",
    children: [
      this.authRouter.register,
      this.authRouter.resetPassword,
      this.authRouter.login,
    ],
  });

  layout = $page({
    component: Layout,
    children: () => [this.home, this.about, this.auth],
  });

  home = $page({
    path: "/",
    component: Home,
  });

  about = $page({
    path: "/about",
    component: () => "about",
  });
}
