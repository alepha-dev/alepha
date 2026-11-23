import { BayUpgrade } from "@lore/core/schemas";

/**
 * What the host page says about the Bay a machine runs (#E152), worked out
 * from three reads the page already has: the host, its inventory, and the
 * last upgrade Lore sent it.
 */
export type BayVersionState =
  | { kind: "unknown" }
  | { kind: "current"; version: string }
  | {
      kind: "upgradable";
      from: string;
      to: string;
      /**
       * Why the button cannot be pressed right now, when it cannot.
       */
      blocked?: "deploysOff" | "offline";
    }
  | {
      kind: "byHand";
      from: string;
      to: string;
      why: "tooOld" | "noDropIn" | "noSystemd";
      command: string;
    }
  | {
      kind: "offlineSinceUpgrade";
      to: string;
      /**
       * `install.sh` with the version the host ran before, when Lore knows
       * it: what puts the machine back if the new Bay does not come up.
       */
      recover?: string;
    };

interface HostFacts {
  online: boolean;
  deployAllowed: boolean;
  lastSeenAt?: string;
}

interface InventoryFacts {
  bayVersion?: string;
  upgradeMode?: string;
  targetBayVersion?: string;
  upgradeAvailable: boolean;
  upgradeByHand: boolean;
}

interface UpgradeFacts {
  status: string;
  step?: string;
  finishedAt?: string;
  payload: { version?: string; fromVersion?: string };
}

/**
 * How long after an upgrade ended a host may still have been seen and count
 * as "not back since": its last frames arrive around the handoff itself.
 */
const SEEN_AROUND_UPGRADE_MS = 120_000;

/**
 * The state the version line draws. A function over plain facts, so each
 * state is a row in a spec rather than a page to stage.
 *
 * ⚠️ "Offline since the upgrade" comes first: an offline host's inventory is
 * the OLD Bay's, so reading it alone would offer the same upgrade again to a
 * machine that may be down because of it.
 */
export const bayVersionState = (
  host: HostFacts,
  inventory: InventoryFacts | undefined,
  lastUpgrade: UpgradeFacts | undefined,
): BayVersionState => {
  if (!host.online && lastUpgrade?.payload.version) {
    // Only an upgrade that got as far as replacing the process: one refused
    // or failed before that left the machine as it was.
    const reachedHandoff =
      lastUpgrade.status === "done" ||
      !lastUpgrade.finishedAt ||
      lastUpgrade.step === "handing over";
    const notSeenSince =
      !lastUpgrade.finishedAt ||
      !host.lastSeenAt ||
      Date.parse(host.lastSeenAt) <=
        Date.parse(lastUpgrade.finishedAt) + SEEN_AROUND_UPGRADE_MS;
    if (reachedHandoff && notSeenSince) {
      const from = lastUpgrade.payload.fromVersion;
      return {
        kind: "offlineSinceUpgrade",
        to: lastUpgrade.payload.version,
        ...(BayUpgrade.isVersion(from)
          ? { recover: BayUpgrade.installCommand(from) }
          : {}),
      };
    }
  }

  const version = inventory?.bayVersion;
  if (!inventory || !version) {
    return { kind: "unknown" };
  }
  const target = inventory.targetBayVersion;
  if (!inventory.upgradeAvailable || !target) {
    return { kind: "current", version };
  }
  if (inventory.upgradeByHand) {
    return {
      kind: "byHand",
      from: version,
      to: target,
      why:
        inventory.upgradeMode === "restart"
          ? "noDropIn"
          : inventory.upgradeMode === "manual"
            ? "noSystemd"
            : "tooOld",
      command: BayUpgrade.byHandCommand(target),
    };
  }
  return {
    kind: "upgradable",
    from: version,
    to: target,
    ...(!host.deployAllowed
      ? { blocked: "deploysOff" as const }
      : !host.online
        ? { blocked: "offline" as const }
        : {}),
  };
};
