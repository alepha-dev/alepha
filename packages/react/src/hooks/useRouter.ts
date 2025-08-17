import { ReactRouter } from "../services/ReactRouter.ts";
import { useInject } from "./useInject.ts";

/**
 * Use this hook to access the React Router instance.
 *
 * You can add a type parameter to specify the type of your application.
 * This will allow you to use the router in a typesafe way.
 *
 * @example
 * class App {
 *   home = $page();
 * }
 *
 * const router = useRouter<App>();
 * router.go("home"); // typesafe
 */
export const useRouter = <T extends object = any>(): ReactRouter<T> => {
	return useInject(ReactRouter<T>);
};
