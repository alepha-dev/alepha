/**
 * The three ways a Bay says it can be upgraded, on its inventory's host
 * block. Only `handoff` takes the `upgrade` command.
 */
export const BAY_UPGRADE_MODES = ["handoff", "restart", "manual"] as const;

export type BayUpgradeMode = (typeof BAY_UPGRADE_MODES)[number];

/**
 * What Lore can say about a host's Bay version, held against the version
 * Lore would install.
 */
export interface BayUpgradeStatus {
  /**
   * The host runs a release older than the target.
   */
  upgradeAvailable: boolean;
  /**
   * It is behind, and cannot take the command: a person runs `install.sh`
   * on the machine.
   */
  upgradeByHand: boolean;
}

/**
 * Bay versions, as Lore compares them (#E152).
 *
 * A version is a strict `x.y.z`, the form of the repository's release tags
 * and the only one Bay's `upgrade` accepts. Anything else (`dev`, a
 * pre-release, a `git describe` string) is not a version here: it cannot be
 * compared, so it is neither behind nor ahead.
 *
 * Browser-loadable, so the host page and the API read a version the same
 * way.
 */
export class BayUpgrade {
  /**
   * The same pattern as Bay's own `strictVersion` (`cmd/bay/upgrade.go`).
   * Neither may loosen without the other: Bay echoes a version it accepted
   * into a command somebody pastes into a root shell.
   */
  static readonly VERSION =
    /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;

  static isVersion(value: string | undefined): value is string {
    return value !== undefined && BayUpgrade.VERSION.test(value);
  }

  /**
   * Negative when `a` is older than `b`, zero when they are the same,
   * `undefined` when either is not a version.
   */
  static compare(
    a: string | undefined,
    b: string | undefined,
  ): number | undefined {
    if (!BayUpgrade.isVersion(a) || !BayUpgrade.isVersion(b)) {
      return undefined;
    }
    const left = a.split(".").map(Number);
    const right = b.split(".").map(Number);
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) {
        return left[index]! - right[index]!;
      }
    }
    return 0;
  }

  /**
   * The Bay version a Lore built as `metaVersion` installs: the release it
   * was built from.
   *
   * A Lore deployed from `main` reports `git describe`, `0.38.0-12-g4ad66a8`:
   * twelve commits after 0.38.0. Under semver that whole string sorts BELOW
   * 0.38.0, so it is never compared as it stands; the release is its `x.y.z`
   * prefix. A Lore with no tag behind it (`latest`) has no release to offer,
   * and neither has a pre-release build, whose prefix names a release that
   * may not exist yet.
   */
  static targetOf(metaVersion: string | undefined): string | undefined {
    const match = /^v?(\d+\.\d+\.\d+)(?:-\d+-g[0-9a-f]+)?$/.exec(
      metaVersion ?? "",
    );
    return match && BayUpgrade.isVersion(match[1]) ? match[1] : undefined;
  }

  /**
   * Whether a host is behind, and whether it can be upgraded from Lore.
   *
   * A Bay that reports no mode is older than the command itself; `restart`
   * has no handoff drop-in and `manual` runs outside systemd. All three are
   * upgraded by hand: there is no swap-and-restart fallback.
   */
  static status(input: {
    bayVersion?: string;
    upgradeMode?: string;
    target?: string;
  }): BayUpgradeStatus {
    const behind =
      (BayUpgrade.compare(input.bayVersion, input.target) ?? 0) < 0;
    return {
      upgradeAvailable: behind,
      upgradeByHand: behind && input.upgradeMode !== "handoff",
    };
  }

  /**
   * The one line that upgrades a host from its own shell. `BAY_UPDATE_UNIT`
   * makes that run install the handoff drop-in too, so the next upgrade can
   * be started from Lore. Word for word what Bay answers in its own refusal.
   */
  static byHandCommand(version: string): string {
    return `curl -sSL https://alepha.dev/bay/install.sh | sudo BAY_VERSION=${version} BAY_UPDATE_UNIT=yes sh`;
  }

  /**
   * `install.sh` pinned to one version: how a host is put back on the Bay it
   * ran before, from its own shell. Lore never sends a host back itself.
   */
  static installCommand(version: string): string {
    return `curl -sSL https://alepha.dev/bay/install.sh | sudo BAY_VERSION=${version} sh`;
  }

  /**
   * Why a host is upgraded by hand, from the mode it reports.
   */
  static byHandReason(upgradeMode: string | undefined): string {
    if (upgradeMode === "restart") {
      return "its systemd unit lacks the handoff drop-in";
    }
    if (upgradeMode === "manual") {
      return "its Bay does not run under systemd";
    }
    return "its Bay is too old to be upgraded from Lore";
  }
}
