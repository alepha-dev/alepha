import { $uiDemo } from "@alepha/mantine/demo";
import { $page } from "alepha/react/router";

export class AppRouter {
  demo = $uiDemo();

  home = $page({
    path: "/",
    redirect: "/demo",
  });
}
