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

export const DevState = () => {
  const meta = useMetadata();
  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });

  const atoms = meta.data?.atoms ?? [];
  const search = params.q ?? "";

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? atoms.filter((a) => a.name.toLowerCase().includes(q))
      : atoms;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [atoms, search]);

  const selected = useMemo(
    () => atoms.find((a) => a.name === params.selected),
    [atoms, params.selected],
  );

  if (meta.error) {
    return <DevError what="state" message={meta.error} onRetry={meta.reload} />;
  }

  if (!meta.loading && atoms.length === 0) {
    return (
      <DevEmpty
        title="No state atoms declared"
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
          {visible.map((atom: DevAtomMetadata) => (
            <button
              key={atom.name}
              type="button"
              className="dt-leaf"
              style={{ paddingLeft: 12 }}
              data-active={params.selected === atom.name || undefined}
              onClick={() => setParams({ ...params, selected: atom.name })}
            >
              <span className="dt-mono">{atom.name}</span>
              {atom.serverOnly ? (
                <span className="dt-nav-count">server</span>
              ) : (
                atom.currentValue !== undefined && (
                  <span
                    className="dt-nav-count"
                    style={{ color: "var(--dt-accent)" }}
                  >
                    set
                  </span>
                )
              )}
            </button>
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

export default DevState;
