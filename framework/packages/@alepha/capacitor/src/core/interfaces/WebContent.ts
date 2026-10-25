/**
 * Where the web layer a WebView is running came from.
 */
export interface WebContent {
  /**
   * `bundled`: the shell built into the binary. `dev`: a development server
   * over the network. `ota`: a bundle a live updater installed after the
   * binary shipped.
   */
  mode: "bundled" | "dev" | "ota";

  /**
   * The origin the page runs on, e.g. `capacitor://localhost`.
   */
  origin: string;

  /**
   * The installed bundle's version, when an updater reports one.
   */
  bundleVersion?: string;
}
