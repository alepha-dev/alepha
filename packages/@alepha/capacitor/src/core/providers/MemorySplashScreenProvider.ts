import { SplashScreenProvider } from "./SplashScreenProvider.ts";

/**
 * Counts the hides a spec caused.
 */
export class MemorySplashScreenProvider extends SplashScreenProvider {
  public hides = 0;

  public override async hide(): Promise<void> {
    this.hides++;
  }
}
