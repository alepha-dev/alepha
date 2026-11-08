import { useInject } from "alepha/react";

import { type RegisteredRouter, ReactRouter } from "../services/ReactRouter.ts";

/**
 * Use this hook to access the React Router instance.
 *
 * It is typed against the app's registered routers (see `Routers`), so page
 * names and their params are checked with no type argument. A type argument
 * still overrides it, and `useRouter<any>()` opts out, which is what code
 * meant to run in any app writes.
 *
 * @example
 * class App {
 *   home = $page();
 * }
 *
 * declare module "alepha/react/router" {
 *   interface Routers {
 *     app: App;
 *   }
 * }
 *
 * const router = useRouter();
 * router.push("home"); // typesafe
 */
export const useRouter = <
  T extends object = RegisteredRouter,
>(): ReactRouter<T> => {
  return useInject(ReactRouter<T>);
};
