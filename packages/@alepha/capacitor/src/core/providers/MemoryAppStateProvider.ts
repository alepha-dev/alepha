import { AppStateProvider } from "./AppStateProvider.ts";

/**
 * An app state a spec moves by hand.
 */
export class MemoryAppStateProvider extends AppStateProvider {
  public listening = false;

  public async setActive(active: boolean): Promise<void> {
    await this.update(active);
  }

  protected override async listen(): Promise<void> {
    this.listening = true;
  }

  protected override async unlisten(): Promise<void> {
    this.listening = false;
  }
}
