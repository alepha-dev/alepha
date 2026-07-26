import { FileText } from "lucide-react";
import { useMemo } from "react";
import type { DevPageMetadata } from "../../../schemas/DevPageMetadata.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { SchemaTree } from "../shared/SchemaTree.tsx";
import { DeclaredScreen } from "./DeclaredScreen.tsx";
import { DetailFields } from "./DetailFields.tsx";

/**
 * Pages declared with `$page`.
 *
 * The rail shows the declared path segment; the detail panel resolves the full
 * path by walking `parentName` up the chain, because a nested page's own
 * `path` is only its segment and reads as wrong on its own.
 */
export const DevPages = () => {
  const meta = useMetadata();
  const all = meta.data?.pages ?? [];

  /**
   * Depth-first by parent, so the rail reads as the route tree the router
   * actually builds. A flat alphabetical list put `campaignSettingsZones`
   * eleven rows away from the layout it renders inside, which is the one
   * relationship that explains what a page's own `path` means.
   */
  const { items, depth } = useMemo(() => {
    const byParent = new Map<string | undefined, DevPageMetadata[]>();
    for (const page of all) {
      const key = page.parentName;
      const list = byParent.get(key);
      if (list) list.push(page);
      else byParent.set(key, [page]);
    }

    const ordered: DevPageMetadata[] = [];
    const depths = new Map<string, number>();
    const seen = new Set<string>();

    const walk = (parent: string | undefined, level: number) => {
      for (const page of byParent.get(parent) ?? []) {
        // A malformed parent chain would otherwise recurse forever; a page
        // already placed keeps its first position.
        if (seen.has(page.name)) continue;
        seen.add(page.name);
        ordered.push(page);
        depths.set(page.name, level);
        walk(page.name, level + 1);
      }
    };

    walk(undefined, 0);
    // Anything whose parent is missing from the metadata still has to appear.
    for (const page of all) {
      if (!seen.has(page.name)) {
        ordered.push(page);
        depths.set(page.name, 0);
      }
    }

    return { items: ordered, depth: depths };
  }, [all]);

  const resolvePath = (page: DevPageMetadata): string => {
    const segments: string[] = [];
    let current: DevPageMetadata | undefined = page;
    const seen = new Set<string>();
    while (current && !seen.has(current.name)) {
      seen.add(current.name);
      if (current.path) segments.unshift(current.path);
      current = items.find((p) => p.name === current?.parentName);
    }
    const joined = segments.join("").replace(/\/{2,}/g, "/");
    return joined || "/";
  };

  return (
    <DeclaredScreen<DevPageMetadata>
      items={items}
      keyOf={(p) => p.name}
      labelOf={(p) => p.name}
      metaOf={(p) => p.path}
      icon={FileText}
      depthOf={(p) => depth.get(p.name) ?? 0}
      filterPlaceholder="Filter pages…"
      emptyHint="Use $page to declare a route"
      renderDetail={(p) => (
        <div>
          <div style={{ padding: "14px 14px 10px" }}>
            <div className="dt-mono" style={{ fontSize: 14 }}>
              {resolvePath(p)}
            </div>
            <div
              style={{ marginTop: 4, fontSize: 12, color: "var(--dt-fg-dim)" }}
            >
              {p.label ?? p.name}
              {p.description ? ` — ${p.description}` : ""}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              padding: "0 14px 12px",
            }}
          >
            {p.hasLazy && <span className="dt-chip">lazy</span>}
            {p.static && <span className="dt-chip">static</span>}
            {p.client && <span className="dt-chip">client-only</span>}
            {p.hasResolve && <span className="dt-chip">loader</span>}
            {p.hasErrorHandler && (
              <span className="dt-chip">error handler</span>
            )}
          </div>

          <div className="dt-section-label">Definition</div>
          <DetailFields
            fields={[
              { label: "Name", value: p.name },
              { label: "Segment", value: p.path },
              { label: "Parent", value: p.parentName },
              {
                label: "Children",
                value: p.childrenNames?.length
                  ? p.childrenNames.join(", ")
                  : undefined,
              },
            ]}
          />

          <SchemaTree
            schema={p.params}
            label="Path parameters"
            rootName="params"
          />
          <SchemaTree
            schema={p.query}
            label="Query parameters"
            rootName="query"
          />
        </div>
      )}
    />
  );
};

export default DevPages;
