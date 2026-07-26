import { z } from "alepha";
import { useQueryParams } from "alepha/react/router";
import { useMemo } from "react";
import type { DevAtomMetadata } from "../../../schemas/DevAtomMetadata.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";
import { AtomDetail } from "./AtomDetail.tsx";

const querySchema = z.object({
  selected: z.text().optional(),
  q: z.text().optional(),
});

export const DevAtoms = () => {
  const meta = useMetadata();
  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });

  const atoms = meta.data?.atoms ?? [];
  const search = params.q ?? "";

  /**
   * The rail groups by the only distinction that changes what an atom *is*:
   * whether its value can leave the process. `serverOnly` atoms are server
   * state; everything else is hydrated into the browser, so a secret placed
   * there is a shipped secret. Sorting by name inside each group keeps the
   * list stable as values change.
   */
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? atoms.filter((a) => a.name.toLowerCase().includes(q))
      : atoms;
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return [
      {
        key: "server",
        title: "Server",
        subtitle: "Never leaves the server.",
        atoms: sorted.filter((a) => a.serverOnly),
      },
      {
        key: "hybrid",
        title: "Hybrid",
        subtitle: "Written on the server, hydrated into the browser.",
        atoms: sorted.filter((a) => !a.serverOnly),
      },
    ].filter((g) => g.atoms.length > 0);
  }, [atoms, search]);

  const selected = useMemo(
    () => atoms.find((a) => a.name === params.selected),
    [atoms, params.selected],
  );

  if (meta.error) {
    return <DevError what="atoms" message={meta.error} onRetry={meta.reload} />;
  }

  if (!meta.loading && atoms.length === 0) {
    return (
      <DevEmpty
        title="No atoms declared"
        hint="Use $atom to declare reactive application state"
      />
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
      <div className="dt-rail" style={{ width: 300 }}>
        <div className="dt-rail-search">
          <input
            className="dt-input"
            placeholder="Filter atoms…"
            value={search}
            onChange={(e) =>
              setParams({ ...params, q: e.currentTarget.value || undefined })
            }
          />
        </div>
        <div className="dt-rail-body">
          {groups.map((group) => (
            <div key={group.key}>
              {/*
               * Title and count on one line, the caption on its own beneath —
               * the caption is a sentence, and squeezing it onto the title row
               * either truncates it or makes the row twice as tall as a leaf.
               */}
              <div className="dt-rail-group">
                <span className="dt-rail-group-mark" data-group={group.key} />
                <span>{group.title}</span>
                <span className="dt-nav-count">{group.atoms.length}</span>
              </div>
              <div className="dt-rail-group-sub">{group.subtitle}</div>
              {group.atoms.map((atom: DevAtomMetadata) => (
                <button
                  key={atom.name}
                  type="button"
                  className="dt-leaf"
                  style={{ paddingLeft: 12 }}
                  data-active={params.selected === atom.name || undefined}
                  onClick={() => setParams({ ...params, selected: atom.name })}
                >
                  <span className="dt-mono">{atom.name}</span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {atom.persist && (
                      <span className="dt-nav-count">{atom.persist}</span>
                    )}
                    {!atom.serverOnly && atom.currentValue !== undefined && (
                      <span
                        className="dt-nav-count"
                        style={{ color: "var(--dt-accent)" }}
                      >
                        set
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="dt-detail">
        {selected ? (
          <AtomDetail atom={selected} onSaved={meta.reload} />
        ) : (
          <DevEmpty title="Select an atom" />
        )}
      </div>
    </div>
  );
};

export default DevAtoms;
