import { $page } from "@alepha/react";
import { AuthRouter } from "@alepha/ui/auth";
import { $inject } from "alepha";
import { Layout } from "./Layout.tsx";

export class AppRouter {
  authRouter = $inject(AuthRouter);

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
    component: () => "Hello World!",
  });

  about = $page({
    path: "/about",
    component: () => "about",
  });
}
