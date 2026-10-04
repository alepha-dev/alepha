import { useState } from "react";

import type { OfflineScreenProps } from "../services/ReactBootHealth.ts";

/**
 * The router's own offline screen: a message and a retry button, unstyled so
 * it depends on no design system. An app passes its own through
 * `ReactBootHealth.offlineScreen`.
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
    <div role="alert" data-alepha-offline={props.reason}>
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
