import { Toaster } from "@alepha/ui/components/ui/sonner";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider } from "@alepha/ui/components/use-dialog/use-dialog";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import {
  Archive,
  Boxes,
  Clock,
  Database,
  Gauge,
  HardDrive,
  Inbox,
  KeyRound,
  LayoutDashboard,
  List,
  LockOpen,
  Network,
  Radio,
  RotateCw,
  ShieldCheck,
  Table2,
  UserRound,
  Variable,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useDevSession } from "../hooks/useDevSession.ts";
import { useMetadata } from "../hooks/useMetadata.ts";
import { CommandPalette } from "./shared/CommandPalette.tsx";
import { DevNavItem } from "./shared/DevNavItem.tsx";

interface NavEntry {
  label: string;
  icon: ComponentType<{ size?: number }>;
  /**
   * Absent while the section's screen is not ported yet.
   */
  href?: string;
  count?: number;
  exact?: boolean;
  /**
   * Streams rather than counts — shows a live dot in place of a number.
   */
  live?: boolean;
}

const DevLayout = () => {
  const state = useRouterState();
  const router = useRouter();
  const meta = useMetadata();
  const session = useDevSession();
  const [paletteOpen, setPaletteOpen] = useState(false);

  /**
   * DevTools v1 is dark-only by design. Screens still on the shadcn stack read
   * the `.dark` token set, so forcing the class here keeps them coherent with
   * the ported chrome instead of showing a light panel inside a dark shell.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.style.colorScheme = "dark";
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const d = meta.data;

  const envCount = useMemo(() => {
    const names = new Set<string>();
    for (const env of d?.envs ?? []) {
      for (const name of Object.keys((env.schema as any)?.properties ?? {})) {
        names.add(name);
      }
    }
    return names.size || undefined;
  }, [d]);

  const groups = useMemo<Array<{ label?: string; items: NavEntry[] }>>(
    () => [
      {
        label: undefined,
        items: [
          { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
        ],
      },
      {
        label: "Declared",
        items: [
          {
            href: "/actions",
            label: "Actions",
            icon: Zap,
            count: d?.actions?.length,
          },
          {
            href: "/pages",
            label: "Pages",
            icon: Archive,
            count: d?.pages?.length,
          },
          {
            href: "/jobs",
            label: "Jobs",
            icon: Clock,
            count: d?.jobs?.length,
          },
          {
            href: "/topics",
            label: "Topics",
            icon: Radio,
            count: d?.topics?.length,
          },
          {
            href: "/caches",
            label: "Caches",
            icon: Boxes,
            count: d?.caches?.length,
          },
          {
            href: "/storage",
            label: "Storage",
            icon: HardDrive,
            count: d?.storages?.length,
          },
          {
            href: "/realms",
            label: "Realms",
            icon: ShieldCheck,
            count: d?.realms?.length,
          },
          {
            href: "/roles",
            label: "Roles",
            icon: KeyRound,
            count: d?.roles?.length,
          },
        ],
      },
      {
        label: "Data",
        items: [
          {
            href: "/schema",
            label: "Schema",
            icon: Table2,
            count: d?.entities?.length,
          },
          { href: "/rows", label: "Rows", icon: Database },
        ],
      },
      {
        label: "Config",
        items: [
          {
            href: "/env",
            label: "Environment",
            icon: Variable,
            // Distinct variable names, not the number of `$env` declarations —
            // one declaration commonly carries a dozen variables, so the raw
            // schema count would badly understate it.
            count: envCount,
          },
          {
            href: "/atoms",
            label: "Atoms",
            icon: Gauge,
            count: d?.atoms?.length,
          },
        ],
      },
      {
        label: "Diagnostics",
        items: [
          { href: "/graph", label: "Graph", icon: Network },
          { href: "/outbox", label: "Outbox", icon: Inbox },
          { href: "/logs", label: "Logs", icon: List, live: true },
        ],
      },
    ],
    [d, envCount],
  );

  /**
   * Exact match, or a match on a full path segment.
   *
   * Matching on the first segment alone lit up every sibling that shared it —
   * `/conf/env` and `/conf/atoms` were both "active" at the same time. The
   * trailing slash is what makes this a segment boundary rather than a string
   * prefix, so `/rows` matches `/rows/users` but `/state` never matches
   * `/stateful`.
   */
  const isActive = useCallback(
    (href?: string, exact?: boolean): boolean => {
      if (!href) return false;
      const path = state.url.pathname;
      if (exact || href === "/") return path === "/";
      return path === href || path.startsWith(`${href}/`);
    },
    [state.url.pathname],
  );

  /**
   * The chip's own copy. `loading` gets its own word so the topbar never
   * flashes "Not signed in" during the round-trip, which would read as a
   * verdict rather than as "not known yet".
   */
  const sessionLabel = session.loading
    ? "Session…"
    : (session.user?.name ??
      session.user?.username ??
      session.user?.email ??
      session.user?.id ??
      "Not signed in");

  const sessionTitle = session.user
    ? [
        "Try It requests run as this session.",
        session.user.realm ? `Realm: ${session.user.realm}` : undefined,
        session.user.roles?.length
          ? `Roles: ${session.user.roles.join(", ")}`
          : "No roles",
      ]
        .filter(Boolean)
        .join("\n")
    : "Try It requests run unauthenticated. Sign in to the application itself, then come back.";

  return (
    <TooltipProvider>
      <DialogProvider>
        <div className="dt-root">
          <div className="dt-topbar">
            <div className="dt-brand">
              <span className="dt-brand-mark">
                <Zap size={12} />
              </span>
              <span>
                {/* The product is Alepha; "DevTools" is which surface of it. */}
                <strong>Alepha</strong>{" "}
                <span style={{ color: "var(--dt-fg-dim)" }}>DevTools</span>
              </span>
            </div>

            <button
              type="button"
              className="dt-search"
              onClick={() => setPaletteOpen(true)}
            >
              <span>Search actions, pages, entities, atoms…</span>
              <span className="dt-kbd">⌘K</span>
            </button>

            <span style={{ marginLeft: "auto" }} />

            {/*
             * A status chip, not a login. Devtools presents no credential of
             * its own: Try It rides the application's own session cookie, so
             * the only useful thing this can do is report who that is.
             * Signed out, it opens the application so you can go and log in;
             * signed in, it re-reads the session.
             */}
            <button
              type="button"
              className="dt-btn"
              data-on={session.user ? true : undefined}
              onClick={() =>
                session.user
                  ? session.reload()
                  : window.open("/", "_blank", "noopener")
              }
              title={sessionTitle}
            >
              {session.user ? <UserRound size={11} /> : <LockOpen size={11} />}
              {sessionLabel}
            </button>

            <button
              type="button"
              className="dt-icon-btn"
              onClick={meta.reload}
              title="Reload metadata"
            >
              <RotateCw size={12} />
            </button>
          </div>

          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <nav className="dt-nav">
              {groups.map((group, gi) => (
                <div key={group.label ?? `g${gi}`}>
                  {group.label && (
                    <div className="dt-nav-group">{group.label}</div>
                  )}
                  {group.items.map((item) => (
                    <DevNavItem
                      key={item.label}
                      label={item.label}
                      icon={item.icon}
                      count={item.count}
                      live={item.live}
                      active={isActive(item.href, item.exact)}
                      onSelect={
                        item.href ? () => router.push(item.href!) : undefined
                      }
                    />
                  ))}
                </div>
              ))}
            </nav>

            <NestedView />
          </div>
        </div>

        {paletteOpen && (
          <CommandPalette
            metadata={d}
            onClose={() => setPaletteOpen(false)}
            onNavigate={(href: string) => {
              setPaletteOpen(false);
              router.push(href);
            }}
          />
        )}
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

export default DevLayout;
