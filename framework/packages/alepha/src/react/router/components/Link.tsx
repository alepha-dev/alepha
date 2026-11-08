import { type AnchorHTMLAttributes, createElement } from "react";

import { useRouter } from "../hooks/useRouter.ts";
import type {
  RegisteredRouter,
  RouterPageName,
  RouterPageParams,
  RouterPath,
  VirtualRouter,
} from "../services/ReactRouter.ts";

/**
 * The props of `<Link>`.
 *
 * `K` is the page name or path given as `href`, inferred at the call site:
 * with a registered router (see `Routers`), a name no page has does not
 * compile, and `params` is typed from that page's `schema.params`, required
 * when it has a required key.
 */
export type LinkProps<
  K extends string = string,
  T extends object = RegisteredRouter,
> = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
  LinkTarget<K, T> & {
    /**
     * The query string, for either form.
     */
    query?: Record<string, string>;
    /**
     * Fetch the page's code before it is clicked: on `hover`, or when the link
     * becomes `visible`. Loader data is never fetched. It only sets
     * `data-prefetch`, which a plain `<a>` can carry too.
     */
    prefetch?: "hover" | "visible";
  };

/**
 * `href` and `params` of a `<Link>`: a path takes no params, a page name the
 * params its page declares. Untyped, any string and a string record, when no
 * router is registered.
 */
export type LinkTarget<
  K extends string,
  T extends object = RegisteredRouter,
> = 0 extends 1 & T
  ? {
      /**
       * A path starting with "/", or a page name. A name no page has throws.
       */
      href: K;
      /**
       * The page's params, when `href` is a page name.
       */
      params?: Record<string, string>;
    }
  : K extends RouterPath
    ? { href: K; params?: undefined }
    : K extends RouterPageName<T>
      ? { href: K } & ({} extends LinkPageParams<K, T>
          ? { params?: LinkPageParams<K, T> }
          : { params: LinkPageParams<K, T> })
      : { href: RouterPath | RouterPageName<T> };

/**
 * The params of a registered page, by name.
 */
export type LinkPageParams<
  K extends string,
  T extends object = RegisteredRouter,
> = RouterPageParams<VirtualRouter<T>[K & keyof VirtualRouter<T>]>;

/**
 * Link component for client-side navigation.
 *
 * It's a simple wrapper around an anchor (`<a>`) element using the `useRouter` hook.
 */
const Link = <K extends string>(props: LinkProps<K>) => {
  // Untyped on purpose: the props are checked above, against the registered
  // router, and `anchor` only needs to resolve what they say.
  const router = useRouter<any>();
  const { params, query, prefetch, ...rest } = props as LinkProps;
  const anchor = router.anchor(props.href, { params, query });

  return createElement(
    "a",
    {
      ...rest,
      ...anchor,
      "data-prefetch": prefetch,
      // Compose instead of overwrite: the caller's onClick always runs, and
      // preventing default in it opts out of the SPA navigation.
      onClick: (ev: React.MouseEvent<HTMLAnchorElement>) => {
        props.onClick?.(ev);
        anchor.onClick?.(ev);
      },
    },
    props.children,
  );
};

export default Link;
