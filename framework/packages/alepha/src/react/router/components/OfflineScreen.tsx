import { useState } from "react";

import type { OfflineScreenProps } from "../services/ReactBootHealth.ts";

/**
 * The router's own offline screen: a message and a retry button, unstyled so
 * it depends on no design system. An app passes its own through
 * `ReactBootHealth.offlineScreen`.
 *
 * Its one style is the safe-area padding: in an edge-to-edge native shell the
 * screen would otherwise sit under the status bar or the Dynamic Island.
 * `--safe-area-inset-*` (set by Capacitor's `SystemBars`) first, then `env()`;
 * both are 0 in a browser.
 */
const OfflineScreen = (props: OfflineScreenProps) => {
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await props.retry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      data-alepha-offline={props.reason}
      style={{
        padding:
          "calc(var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) + 16px) calc(var(--safe-area-inset-right, env(safe-area-inset-right, 0px)) + 16px) 16px calc(var(--safe-area-inset-left, env(safe-area-inset-left, 0px)) + 16px)",
      }}
    >
      <p>
        {props.reason === "deadline"
          ? "The server is taking too long to answer."
          : "The server cannot be reached."}
      </p>
      <button type="button" onClick={retry} disabled={retrying}>
        {retrying ? "Retrying..." : "Retry"}
      </button>
    </div>
  );
};

export default OfflineScreen;
