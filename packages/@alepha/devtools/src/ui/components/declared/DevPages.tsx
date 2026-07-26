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
  const items = meta.data?.pages ?? [];

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
