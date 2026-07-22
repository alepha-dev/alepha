/**
 * Restore a working `window.localStorage` / `window.sessionStorage` in the
 * jsdom test environment.
 *
 * jsdom ships a spec-compliant `Storage`, but vitest's jsdom environment never
 * installs it on the global `window` when the host Node already exposes a
 * `localStorage` global: `populateGlobal` skips any jsdom window key that is
 * already `in globalThis` unless the key is on vitest's internal allow-list,
 * and `localStorage` / `sessionStorage` are not on that list. Node >= 25 ships
 * Web Storage enabled by default, so its (unbacked, method-less) native global
 * wins and jsdom's real `Storage` is dropped — `window.localStorage.setItem`
 * becomes `undefined`.
 *
 * This runs once per browser test file (see `setupFiles` on the jsdom project
 * in `vitest.config.ts`). It is a no-op wherever the environment already
 * provides a usable `Storage`, so nothing changes on Node < 25 or in a real
 * browser — it only fills the gap left by the vitest/Node interaction.
 */

class MemoryStorage {
  protected data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    const value = this.data.get(String(key));
    return value === undefined ? null : value;
  }

  setItem(key: string, value: string): void {
    this.data.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.data.delete(String(key));
  }

  clear(): void {
    this.data.clear();
  }
}

const isUsableStorage = (value: unknown): value is Storage =>
  !!value &&
  typeof (value as Storage).getItem === "function" &&
  typeof (value as Storage).setItem === "function" &&
  typeof (value as Storage).removeItem === "function" &&
  typeof (value as Storage).clear === "function";

const ensureStorage = (kind: "localStorage" | "sessionStorage"): void => {
  if (typeof window === "undefined") {
    return;
  }
  if (isUsableStorage((window as unknown as Record<string, unknown>)[kind])) {
    return;
  }
  Object.defineProperty(window, kind, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
};

ensureStorage("localStorage");
ensureStorage("sessionStorage");
