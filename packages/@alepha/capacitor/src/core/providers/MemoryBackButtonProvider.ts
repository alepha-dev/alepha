import { BackButtonProvider } from "./BackButtonProvider.ts";

/**
 * Records the exits a spec's presses caused, instead of closing anything.
 */
export class MemoryBackButtonProvider extends BackButtonProvider {
  public exits = 0;

  protected override async exit(): Promise<void> {
    this.exits++;
  }
}
