import { AppShell } from "@alepha/ui/components/app-shell/app-shell";
import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { useAuth } from "alepha/react/auth";
import { useRouter, useRouterState } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import {
  ArrowLeft,
  Bell,
  Files,
  KeyRound,
  LayoutDashboard,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  UsersIcon,
} from "lucide-react";
import { useMemo } from "react";

/**
 * Per-page metadata used to compute the breadcrumb trail. Keyed by the
 * URL path segment under `/admin/`.
 */
const PAGE_META: Record<string, { label: string }> = {
  users: { label: "Users" },
  sessions: { label: "Sessions" },
  keys: { label: "API keys" },
  jobs: { label: "Jobs" },
  notifications: { label: "Notifications" },
  audits: { label: "Audit log" },
  files: { label: "Files" },
  parameters: { label: "Parameters" },
};

/**
 * `permission` is the UI gate for the nav entry (hidden when the user lacks
 * it). The real route gate is `use: [$secure(...)]` on each leaf page in
 * AppAdminRouter — these must stay in sync.
 */
const NAV_GROUPS = [
  {
    label: "Identity",
    items: [
      {
        href: "/admin/users",
        label: "Users",
        icon: UsersIcon,
        permission: "admin:user:read",
      },
      {
        href: "/admin/sessions",
        label: "Sessions",
        icon: ShieldCheck,
        permission: "admin:session:read",
      },
      {
        href: "/admin/keys",
        label: "API keys",
        icon: KeyRound,
        permission: "admin:api-key:read",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/admin/jobs",
        label: "Jobs",
        icon: Timer,
        permission: "admin:job:read",
      },
      {
        href: "/admin/notifications",
        label: "Notifications",
        icon: Bell,
        permission: "admin:notification:read",
      },
      {
        href: "/admin/audits",
        label: "Audit log",
        icon: ShieldAlert,
        permission: "admin:audit:read",
      },
      {
        href: "/admin/files",
        label: "Files",
        icon: Files,
        permission: "admin:file:read",
      },
      {
        href: "/admin/parameters",
        label: "Parameters",
        icon: SlidersHorizontal,
        permission: "admin:parameter:read",
      },
    ],
  },
];

/**
 * Lore admin shell. Sidebar nav grouped Identity / Operations,
 * breadcrumbs derived from the active sub-route, dark-mode toggle and
 * account menu on the right.
 */
export function AppAdminLayout() {
  const router = useRouter<any>();
  const state = useRouterState();
  const { has } = useAuth();
  const path = state.url?.pathname ?? "/admin";

  const breadcrumbs = useMemo(() => {
    const crumbs: { label: string; href?: string }[] = [
      { label: "Admin", href: "/admin/users" },
    ];
    const rest = path.replace(/^\/admin\/?/, "").split("/");
    const segment = rest[0];
    const meta = segment ? PAGE_META[segment] : undefined;
    if (meta) {
      const hasSub = rest.length > 1 && rest[1] !== "";
      if (hasSub) {
        crumbs.push({ label: meta.label, href: `/admin/${segment}` });
        crumbs.push({ label: "Details" });
      } else {
        crumbs.push({ label: meta.label });
      }
    }
    return crumbs;
  }, [path]);

  // Hide entries the user lacks permission for (UI gate — the route is
  // really gated by `use: [$secure(...)]`), then decorate the rest with
  // per-item `active` so the AppShell sidebar highlights the current row.
  // Groups left with no visible items are dropped.
  const nav = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items
          .filter((item) => has(item.permission))
          .map((item) => ({
            ...item,
            active: path === item.href || path.startsWith(`${item.href}/`),
          })),
      })).filter((group) => group.items.length > 0),
    [path, has],
  );

  return (
    // `h-svh` bounds the shell at the viewport. Combined with `fill` on
    // AppShell (switches SidebarProvider from `min-h-svh` to `h-full`),
    // this lets the table body scroll inside the main area instead of
    // pushing the whole page taller. Without this, `min-h-svh` grows
    // to fit content and the breadcrumb / toolbar / pager scroll away.
    <div className="flex h-svh flex-col">
      {/* `/admin` is not a child of the global Layout (AppRouter.layout.children),
        so we mount ColorScheme here ourselves. Without this, the dark/light
        toggle changes the atom but no React subscriber applies the class
        to <html>, so the page only repaints on a full reload (when the
        inline boot script in UiPersistence.ts runs). */}
      <ColorScheme />
      <AppShell
        fill
        brand={
          <div className="flex items-center gap-2 px-2 py-1.5">
            <button
              type="button"
              onClick={() => router.push("home")}
              aria-label="Back to home"
              className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
            >
              <ArrowLeft className="size-4" />
            </button>
            <LayoutDashboard className="size-4 shrink-0" />
            <span className="text-sm font-semibold tracking-tight">
              Admin Panel
            </span>
          </div>
        }
        nav={nav}
        breadcrumbs={breadcrumbs}
        topbarActions={
          <div className="flex items-center gap-1">
            <ButtonLanguage />
            <ButtonDark />
            <ButtonUser
              onSignIn={() => router.push("login")}
              onAdminClick={() => router.push("home")}
            />
          </div>
        }
      />
    </div>
  );
}
