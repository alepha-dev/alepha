import { $page } from "@alepha/react";
import { AlephaMantineProvider } from "@alepha/ui";
import { AdminRouter } from "@alepha/ui/admin";
import { AuthRouter } from "@alepha/ui/auth";
import { $inject } from "alepha";

export class AppRouter {
  auth = $inject(AuthRouter);
  admin = $inject(AdminRouter);
  layout = $page({
    component: AlephaMantineProvider,
    children: () => [this.auth.layout, this.admin.layout],
  });

  home = $page({
    parent: this.layout,
    component: () => "Hey there! This is the main app layout.",
  });
}
