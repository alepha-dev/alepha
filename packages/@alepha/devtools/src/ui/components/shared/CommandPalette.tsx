import { useEffect, useMemo, useRef, useState } from "react";
import type { DevMetadata } from "../../../schemas/DevMetadata.ts";

export interface CommandPaletteProps {
  metadata?: DevMetadata;
  onClose: () => void;
  onNavigate: (href: string) => void;
}

interface PaletteEntry {
  kind: string;
  label: string;
  hint: string;
  href: string;
  tone: string;
}

/**
 * ⌘K search across everything the metadata knows about.
 *
 * Only kinds with a ported destination are listed — an entry that navigates
 * nowhere is worse than no entry.
 */
export const CommandPalette = (props: CommandPaletteProps) => {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const entries = useMemo<PaletteEntry[]>(() => {
    const m = props.metadata;
    if (!m) return [];
    const out: PaletteEntry[] = [];

    for (const a of m.actions ?? []) {
      out.push({
        kind: "action",
        label: a.name,
        hint: `${a.method} ${a.fullPath}`,
        href: `/actions?selected=${encodeURIComponent(`${a.method}:${a.fullPath}`)}`,
        tone: "var(--dt-accent)",
      });
    }
    for (const e of m.entities ?? []) {
      out.push({
        kind: "entity",
        label: e.name,
        hint: `${e.columns?.length ?? 0} columns`,
        href: `/rows/${encodeURIComponent(e.name)}`,
        tone: "var(--dt-get)",
      });
    }
    for (const a of m.atoms ?? []) {
      out.push({
        kind: "atom",
        label: a.name,
        hint: a.description ?? "",
        href: "/atoms",
        tone: "var(--dt-info)",
      });
    }
    for (const r of m.roles ?? []) {
      out.push({
        kind: "role",
        label: r.name,
        hint: `${r.effective.length} permissions`,
        href: "/roles",
        tone: "var(--dt-warn)",
      });
    }
    return out;
  }, [props.metadata]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? entries.filter(
          (e) =>
            e.label.toLowerCase().includes(q) ||
            e.hint.toLowerCase().includes(q),
        )
      : entries;
    return pool.slice(0, 40);
  }, [entries, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && results[cursor]) {
      props.onNavigate(results[cursor].href);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
      onClick={props.onClose}
    >
      <div
        style={{
          width: 620,
          maxWidth: "90vw",
          background: "var(--dt-panel)",
          border: "1px solid var(--dt-border)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "70vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="dt-input"
          style={{
            height: 38,
            border: 0,
            borderBottom: "1px solid var(--dt-border)",
          }}
          placeholder="Search actions, entities, atoms…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />

        <div style={{ overflowY: "auto" }}>
          {results.length === 0 && (
            <div
              style={{
                padding: 20,
                fontSize: 12,
                color: "var(--dt-fg-faint)",
                textAlign: "center",
              }}
            >
              {props.metadata ? "No matches" : "Loading metadata…"}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}:${r.label}:${r.hint}`}
              type="button"
              className="dt-leaf"
              data-active={i === cursor || undefined}
              style={{ paddingLeft: 12 }}
              onMouseEnter={() => setCursor(i)}
              onClick={() => props.onNavigate(r.href)}
            >
              <span className="dt-method" style={{ color: r.tone, width: 46 }}>
                {r.kind}
              </span>
              <span className="dt-mono">{r.label}</span>
              <span
                style={{
                  marginLeft: "auto",
                  color: "var(--dt-fg-faint)",
                  fontSize: 10,
                }}
                className="dt-mono"
              >
                {r.hint}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
