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

  return createElement(
    "a",
    { ...props, ...router.anchor(props.href) },
    props.children,
  );
};

export default Link;
