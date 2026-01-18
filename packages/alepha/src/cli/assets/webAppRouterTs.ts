export const webAppRouterTs = () => `
import { $page } from "@alepha/react/router";
import { Hello } from "./components/Hello.tsx";

export class AppRouter {
  home = $page({
    component: Hello,
  });
}
`.trim();
