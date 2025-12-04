import { $page } from "@alepha/react";
import { $head } from "@alepha/react/head";
import { AlephaMantineProvider } from "@alepha/ui";
import { AuthRouter } from "@alepha/ui/auth";
import { $inject } from "alepha";
import href from "../../styles.css?url";
import { AdminRouter } from "./AdminRouter.ts";

/**
 * Main application router that combines Auth and Admin routers.
 *
 * We assume that the main application router will always have Admin and Auth routers.
 *
 * This is basically a convenience class to avoid having to inject these routers everywhere.
 * Code is lightweight enough that we can just copy it if needed.
 */
export class MainRouter {
  auth = $inject(AuthRouter);
  admin = $inject(AdminRouter);

  styles = $head(() => ({
    link: [{ rel: "stylesheet", href }],
  }));

  layout = $page({
    component: AlephaMantineProvider,
    children: () => [this.auth.layout, this.admin.layout],
  });
}
