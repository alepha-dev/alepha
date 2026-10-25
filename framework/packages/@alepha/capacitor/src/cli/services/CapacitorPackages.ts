/**
 * The Capacitor packages a native app installs, pinned.
 *
 * One exact set, recorded here so every app `alepha capacitor init` touches
 * resolves the same native code: a floating range would let two machines
 * build two different binaries from one lockfile-less checkout. Capacitor 8
 * is the chosen major (8.4.0 is the floor: the `SystemBars` edge-to-edge
 * fixes the native chrome relies on). Checked on npm on 2026-10-04.
 */
export class CapacitorPackages {
  /**
   * Runtime dependencies of the app: the bridge, the two platforms and the
   * plugins `@alepha/capacitor/core` drives.
   */
  public readonly dependencies: Record<string, string> = {
    "@capacitor/core": "8.5.2",
    "@capacitor/ios": "8.5.2",
    "@capacitor/android": "8.5.2",
    "@capacitor/app": "8.1.2",
    "@capacitor/device": "8.0.3",
    "@capacitor/haptics": "8.0.2",
    "@capacitor/splash-screen": "8.0.2",
    "@aparajita/capacitor-secure-storage": "8.0.1",
  };

  /**
   * Development dependencies: the `cap` binary every command drives.
   */
  public readonly devDependencies: Record<string, string> = {
    "@capacitor/cli": "8.5.2",
  };

  /**
   * The command that runs the app's own `cap` binary through its package
   * manager, so the pinned CLI answers rather than whatever a global install
   * or `npx` would fetch.
   */
  public cap(pm: "yarn" | "npm" | "pnpm" | "bun", args: string): string {
    switch (pm) {
      case "yarn":
        return `yarn cap ${args}`;
      case "pnpm":
        return `pnpm exec cap ${args}`;
      case "bun":
        return `bunx cap ${args}`;
      default:
        return `npx --no-install cap ${args}`;
    }
  }
}
