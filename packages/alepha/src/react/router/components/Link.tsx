import { type AnchorHTMLAttributes, createElement } from "react";
import { useRouter } from "../hooks/useRouter.ts";

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

/**
 * Link component for client-side navigation.
 *
 * It's a simple wrapper around an anchor (`<a>`) element using the `useRouter` hook.
 */
const Link = (props: LinkProps) => {
  const router = useRouter();
  const anchor = router.anchor(props.href);

  return createElement(
    "a",
    {
      ...props,
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
