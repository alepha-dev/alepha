/**
 * The native launch splash. A no-op on the web, which has none.
 *
 * {@link NativeChrome} hides it when the first screen settles; the shell's
 * `launchShowDuration` is only a backstop for a WebView whose JavaScript never
 * got that far.
 */
export class SplashScreenProvider {
  public async hide(): Promise<void> {}
}
