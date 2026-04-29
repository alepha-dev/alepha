import { Link, useRouterState } from "alepha/react/router";
import type { ReactNode } from "react";

export interface MeLayoutNavLinkProps {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
}

const MeLayoutNavLink = (props: MeLayoutNavLinkProps) => {
  const state = useRouterState();
  const active = state.url.pathname === props.href;

  return (
    <Link
      href={props.href}
      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {props.icon}
      <span className="hidden sm:inline">{props.children}</span>
    </Link>
  );
};

export default MeLayoutNavLink;
