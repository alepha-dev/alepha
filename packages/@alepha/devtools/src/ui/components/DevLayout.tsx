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
  LayoutDashboard,
  List,
  Lock,
  LockOpen,
  Network,
  Radio,
  ShieldCheck,
  Table2,
  Terminal,
  Variable,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDevAuth } from "../hooks/useDevAuth.ts";
import { useMetadata } from "../hooks/useMetadata.ts";
import { AuthorizeSheet } from "./shared/AuthorizeSheet.tsx";
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
}

const DevLayout = () => {
  const state = useRouterState();
  const router = useRouter();
  const meta = useMetadata();
  const auth = useDevAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

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
            href: "/buckets",
            label: "Buckets",
            icon: HardDrive,
            count: d?.buckets?.length,
          },
          {
            href: "/realms",
            label: "Realms",
            icon: ShieldCheck,
            count: d?.realms?.length,
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
            href: "/state",
            label: "State",
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
          { href: "/logs", label: "Logs", icon: List },
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

  return (
    <TooltipProvider>
      <DialogProvider>
        <div className="dt-root">
          <div className="dt-topbar">
            <div className="dt-brand">
              <span className="dt-brand-mark">
                <Terminal size={12} />
              </span>
              <span>
                Alepha <strong>DevTools</strong>
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

            <button
              type="button"
              className="dt-btn"
              data-on={auth.authorized || undefined}
              onClick={() => setAuthOpen(true)}
              title="Credentials applied to Try It requests"
            >
              {auth.authorized ? <Lock size={11} /> : <LockOpen size={11} />}
              {auth.authorized ? "Authorized" : "Authorize"}
            </button>

            <span className="dt-chip" title="Runtime">
              {d?.system
                ? `${d.system.runtime} ${d.system.nodeVersion}`
                : "connecting…"}
            </span>
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
                      active={isActive(item.href, item.exact)}
                      onSelect={
                        item.href ? () => router.push(item.href!) : undefined
                      }
                    />
                  ))}
                </div>
              ))}

              <div className="dt-nav-foot">
                @alepha/devtools
                <br />
                {d?.system ? `${d.system.mode} · :${d.system.port}` : "…"}
              </div>
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
        {authOpen && <AuthorizeSheet onClose={() => setAuthOpen(false)} />}
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

export default DevLayout;
