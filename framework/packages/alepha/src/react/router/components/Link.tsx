import { type AnchorHTMLAttributes, createElement } from "react";

import { useRouter } from "../hooks/useRouter.ts";

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /**
   * A path starting with "/", or a page name. A name no page has throws.
   */
  href: string;
  /**
   * The page's params, when `href` is a page name.
   */
  params?: Record<string, string>;
  /**
   * The query string, for either form.
   */
  query?: Record<string, string>;
}

/**
 * Link component for client-side navigation.
 *
 * It's a simple wrapper around an anchor (`<a>`) element using the `useRouter` hook.
 */
const Link = (props: LinkProps) => {
  const router = useRouter();
  const { params, query, ...rest } = props;
  // `useRouter()` is untyped here, so a name is any string; the router
  // throws at runtime for one no page has.
  const anchor = router.anchor(props.href, { params, query });

  return createElement(
    "a",
    {
      ...rest,
      ...anchor,
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
