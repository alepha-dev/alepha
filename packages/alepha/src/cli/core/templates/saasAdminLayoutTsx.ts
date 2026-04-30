/**
 * SaaS admin layout — full AppShell on /admin with a sidebar, breadcrumbs,
 * a Sonner toaster, and a confirm provider. The page list grows with
 * whatever `admin-*` registry components the user adds.
 *
 * All UI primitives come from `src/components/*` where `shadcn add` drops
 * them; alepha app code lives in `src/web/*` and references them via the
 * `@/components/*` alias.
 */
export const saasAdminLayoutTsx = () =>
  `import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/use-confirm";
import { NestedView, useRouterState } from "alepha/react/router";
import { ShieldCheck, Users } from "lucide-react";

const NAV = [
  {
    label: "Identity",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/sessions", label: "Sessions", icon: ShieldCheck },
    ],
  },
] as const;

const findCrumbs = (pathname: string): { label: string; href?: string }[] => {
  for (const group of NAV) {
    const match = group.items.find((it) => it.href === pathname);
    if (match) return [{ label: group.label }, { label: match.label }];
  }
  return [];
};

const AdminLayout = () => {
  const state = useRouterState();
  const crumbs = findCrumbs(state.url.pathname);

  return (
    <TooltipProvider>
      <ConfirmProvider>
        <AppShell
          brand={
            <a
              href="/admin"
              className="flex items-center gap-2 px-2 py-2 font-semibold group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            >
              <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded">
                α
              </span>
              <span className="truncate group-data-[collapsible=icon]:hidden">
                Admin
              </span>
            </a>
          }
          nav={NAV.map((group) => ({
            label: group.label,
            items: group.items.map((it) => ({
              href: it.href,
              label: it.label,
              icon: it.icon,
              active: it.href === state.url.pathname,
            })),
          }))}
          breadcrumbs={crumbs.length ? crumbs : undefined}
        >
          <NestedView />
        </AppShell>
        <Toaster />
      </ConfirmProvider>
    </TooltipProvider>
  );
};

export default AdminLayout;
`;
