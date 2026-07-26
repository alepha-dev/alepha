import { ArrowRight } from "lucide-react";
import type { DevAtomMetadata } from "../../../schemas/DevAtomMetadata.ts";

export interface AtomChannelsProps {
  atom: DevAtomMetadata;
}

const ADAPTER_NOTE: Record<string, string> = {
  cookie:
    "Synced to an HTTP cookie, readable by the server during SSR and by the browser. Unsigned and client-writable.",
  localStorage:
    "Written to localStorage in the browser. Survives reloads and tabs; never seen by the server.",
  sessionStorage:
    "Written to sessionStorage in the browser. Cleared when the tab closes; never seen by the server.",
};

/**
 * How — and whether — an atom's value reaches the browser.
 *
 * The two flags that decide this (`serverOnly` and `persist`) are mutually
 * exclusive and enforced at `$atom()` call time, so an atom is exactly one of:
 * server-only, hydrated via SSR, or hydrated *and* persisted through an
 * adapter. Spelling the route out is the difference between "this is state"
 * and "this value leaves the process".
 */
export const AtomChannels = (props: AtomChannelsProps) => {
  const atom = props.atom;

  if (atom.serverOnly) {
    return (
      <>
        <div className="dt-section-label">
          Channels to the browser
          <span
            className="dt-chip"
            style={{
              textTransform: "none",
              letterSpacing: 0,
              color: "var(--dt-fg-faint)",
            }}
          >
            never leaves the server
          </span>
        </div>
        <div
          style={{
            padding: "10px 14px",
            fontSize: 11,
            color: "var(--dt-fg-dim)",
          }}
        >
          Declared <span className="dt-mono">serverOnly</span> — excluded from
          the application's SSR hydration payload, so no browser it serves ever
          receives this value. Devtools reads it straight off the server, which
          is why it is shown above.
        </div>
      </>
    );
  }

  return (
    <>
      <div className="dt-section-label">
        Channels to the browser
        <span
          className="dt-chip"
          style={{
            textTransform: "none",
            letterSpacing: 0,
            color: "var(--dt-get)",
            borderColor: "var(--dt-get)",
          }}
        >
          reaches the browser
        </span>
      </div>

      <div style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          <ArrowRight
            size={13}
            style={{ color: "var(--dt-get)", flex: "none", marginTop: 2 }}
          />
          <div>
            <div style={{ fontSize: 12 }}>
              SSR hydration payload{" "}
              <span
                className="dt-mono"
                style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}
              >
                &lt;script id="__ssr"&gt;
              </span>
            </div>
            <div style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}>
              Serialized into the HTML and hydrated into the client store.
            </div>
          </div>
        </div>

        {atom.persist && (
          <div style={{ display: "flex", gap: 12 }}>
            <ArrowRight
              size={13}
              style={{ color: "var(--dt-get)", flex: "none", marginTop: 2 }}
            />
            <div>
              <div style={{ fontSize: 12 }}>
                Persistence · {atom.persist}{" "}
                <span
                  className="dt-mono"
                  style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}
                >
                  persist: "{atom.persist}"
                </span>
              </div>
              <div style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}>
                {ADAPTER_NOTE[atom.persist] ??
                  "Synced through a persistence adapter in the browser."}
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        className="dt-mono"
        style={{
          padding: "0 14px 12px",
          fontSize: 10,
          color: "var(--dt-fg-faint)",
        }}
      >
        serverOnly and persist are mutually exclusive. Declaring both throws at
        $atom() call time, because every persistence adapter targets the browser
        by definition.
      </div>
    </>
  );
};
