import { useInject } from "alepha/react";
import { HttpClient } from "alepha/server";
import { useEffect, useState } from "react";

export interface ConfigAtomsMutationsProps {
  atomName: string;
}

/**
 * "Recent mutations" list for the selected atom, fed by
 * GET /__devtools/api/atoms/log.
 */
export const ConfigAtomsMutations = (props: ConfigAtomsMutationsProps) => {
  const http = useInject(HttpClient);
  const [entries, setEntries] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    http
      .fetch(
        `/__devtools/api/atoms/log?key=${encodeURIComponent(props.atomName)}`,
      )
      .then((res) => {
        if (!cancelled) {
          setEntries((res.data as any).entries ?? []);
        }
      })
      .catch((error) => {
        // Never swallow: a failing mutation-log fetch would otherwise render
        // as "no recent mutations", which is indistinguishable from a
        // healthy, idle atom. Same reporting as the sibling ConfigAtoms
        // save handler.
        console.error("Failed to load atom mutation log:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [http, props.atomName]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div>
      <p className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-wider">
        Recent Mutations
      </p>
      <div className="flex flex-col gap-2">
        {entries.map((entry, index) => (
          <pre
            key={`${entry.at}-${index}`}
            className="bg-muted overflow-auto rounded p-2 text-xs"
          >
            {new Date(entry.at).toLocaleTimeString()} →{" "}
            {JSON.stringify(entry.value)}
          </pre>
        ))}
      </div>
    </div>
  );
};
