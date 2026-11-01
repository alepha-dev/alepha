import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";

/**
 * What a data prefetch left for the navigation that follows it: the loader
 * results of the layers it ran, each used once.
 *
 * Keyed by route, layer identity and decoded query, the same three things
 * that decide whether a layer is reused, so an entry can only stand in for the
 * loader it replaces.
 */
export class ReactPrefetchCache {
  protected readonly dateTime = $inject(DateTimeProvider);

  /**
   * How long a result stays usable. Short: nothing invalidates it, so a write
   * made meanwhile is only covered by it running out.
   */
  protected readonly ttl = 30_000;

  protected readonly maxEntries = 8;

  protected readonly entries = new Map<
    string,
    { props: Record<string, any>; at: number }
  >();

  protected readonly running = new Map<string, Promise<void>>();

  public key(name: string, layerKey: string | undefined, query: unknown) {
    return JSON.stringify([name, layerKey, query ?? {}]);
  }

  public put(key: string, props: Record<string, any>): void {
    this.entries.delete(key);
    this.entries.set(key, { props, at: this.dateTime.nowMillis() });

    // A Map iterates in insertion order, so the first key is the oldest.
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }

  public has(key: string): boolean {
    const entry = this.entries.get(key);
    return !!entry && this.isFresh(entry.at);
  }

  /**
   * The result for `key`, removed: an entry is used once.
   */
  public take(key: string): Record<string, any> | undefined {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    return entry && this.isFresh(entry.at) ? entry.props : undefined;
  }

  protected isFresh(at: number): boolean {
    return this.dateTime.nowMillis() - at < this.ttl;
  }

  /**
   * Note a prefetch of `url` as running until `work` settles, so a click that
   * lands meanwhile waits for it rather than sending the same requests again.
   */
  public track(url: string, work: Promise<void>): void {
    const done = work.finally(() => this.running.delete(url));
    this.running.set(url, done);
  }

  public isRunning(url: string): boolean {
    return this.running.has(url);
  }

  /**
   * Resolves once no prefetch of `url` is running. Never rejects.
   */
  public async settled(url: string): Promise<void> {
    await this.running.get(url);
  }
}
