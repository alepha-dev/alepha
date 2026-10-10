/**
 * A web layer the updater knows on this device, as it reports it.
 */
export interface OtaBundle {
  /**
   * The updater's own id: `builtin` for the layer inside the binary.
   */
  id: string;

  /**
   * The bundle version, or the store version for `builtin`.
   */
  version: string;

  status:
    | "success"
    | "error"
    | "pending"
    | "downloading"
    | "deleted"
    | "deleting";
}

/**
 * The updater's answer to an update check: the server's body as the plugin
 * decoded it (`session_key` read into `sessionKey`), plus the HTTP status.
 */
export interface OtaLatest {
  version?: string;
  url?: string;
  sessionKey?: string;
  checksum?: string;
  error?: string;
  kind?: string;
  message?: string;
  statusCode?: number;
}
