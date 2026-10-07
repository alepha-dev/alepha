import { $page } from "alepha/react/router";

/**
 * One page, and no loader: nothing the app shows comes from a server, so the
 * native shell boots the same with or without a network.
 */
export class AppRouter {
  calculator = $page({
    path: "/",
    lazy: () => import("./pages/Calculator.tsx"),
  });
}
