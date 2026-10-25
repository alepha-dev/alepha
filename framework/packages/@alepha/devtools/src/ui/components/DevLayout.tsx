import { Toaster, TooltipProvider, DialogProvider } from "@alepha/ui";
import type { InspectorRun } from "alepha/inspector";
import { useAlepha } from "alepha/react";
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
  Network,
  Radio,
  RotateCw,
  ShieldCheck,
  Table2,
  Variable,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { devRowCountsAtom } from "../atoms/devRowCountsAtom.ts";
import { useMetadata } from "../hooks/useMetadata.ts";
import { useRunHref } from "../hooks/useRunHref.ts";
import { useRunId } from "../hooks/useRunId.ts";
import { useRuns } from "../hooks/useRuns.ts";
import { RunSwitcher } from "./runs/RunSwitcher.tsx";
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
  const alepha = useAlepha();
  const meta = useMetadata();
  const runId = useRunId();
  const href = useRunHref();
  const { runs, loaded } = useRuns();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const current = runs.find((run) => run.runId === runId);
  const lastSeen = useRef<InspectorRun | undefined>(undefined);

  /**
   * Under `alepha dev` every reload is a new run of the same app: the run
   * being inspected vanishes and one with the same `cwd` appears. That is a
   * restart, and the selection follows it, on the same panel.
   */
  useEffect(() => {
    if (current) {
      lastSeen.current = current;
      return;
    }
    const previous = lastSeen.current;
    if (!previous) return;
    const successor = runs.find(
      (run) =>
        run.cwd === previous.cwd &&
        run.status === "live" &&
        run.startedAt.localeCompare(previous.startedAt) >= 0,
    );
    if (successor) {
      const prefix = `/apps/${encodeURIComponent(runId)}`;
      const rest = state.url.pathname.startsWith(prefix)
        ? state.url.pathname.slice(prefix.length)
        : "";
      void router.push(
        `/apps/${encodeURIComponent(successor.runId)}${rest}${state.url.search}`,
      );
    }
  }, [current, runs, runId, router, state.url]);

  // Row counts belong to one run's database.
  useEffect(() => {
    alepha.store.set(devRowCountsAtom, {});
  }, [alepha, runId]);

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
    (target?: string, exact?: boolean): boolean => {
      if (!target) return false;
      const root = href("/");
      const path = state.url.pathname.replace(/\/$/, "") || "/";
      if (exact || target === "/") return path === root;
      const full = href(target);
      return path === full || path.startsWith(`${full}/`);
    },
    [state.url.pathname, href],
  );

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

            <RunSwitcher
              runs={runs}
              current={current}
              onSelect={(run) =>
                router.push(`/apps/${encodeURIComponent(run.runId)}`)
              }
            />

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
                        item.href
                          ? () => router.push(href(item.href!))
                          : undefined
                      }
                    />
                  ))}
                </div>
              ))}
            </nav>

            {loaded && !current ? (
              <div style={{ flex: 1, padding: 24 }}>
                <div className="dt-banner">
                  This app is not running any more (run {runId}).{" "}
                  <button
                    type="button"
                    className="dt-btn"
                    onClick={() => router.push("/")}
                  >
                    Pick an app
                  </button>
                </div>
              </div>
            ) : (
              <NestedView />
            )}
          </div>
        </div>

        {paletteOpen && (
          <CommandPalette
            metadata={d}
            onClose={() => setPaletteOpen(false)}
            onNavigate={(target: string) => {
              setPaletteOpen(false);
              void router.push(href(target));
            }}
          />
        )}
        <Toaster />
      </DialogProvider>
    </TooltipProvider>
  );
};

export default DevLayout;
