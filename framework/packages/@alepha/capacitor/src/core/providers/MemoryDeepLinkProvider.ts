import { DeepLinkProvider } from "./DeepLinkProvider.ts";

/**
 * Deep links a spec plays: a launch URL, and links opened later.
 */
export class MemoryDeepLinkProvider extends DeepLinkProvider {
  public launch?: string;
  public listening = false;

  /**
   * A link opened while the app runs, as `appUrlOpen` would report it.
   */
  public async open(url: string): Promise<void> {
    await this.receive(url);
  }

  protected override async launchUrl(): Promise<string | undefined> {
    return this.launch;
  }

  protected override async listen(): Promise<void> {
    this.listening = true;
  }

  protected override async unlisten(): Promise<void> {
    this.listening = false;
  }
}
