import { BayReleaseTarget, HostCommandService } from "@lore/core/api";
import type { HostCommand, Host } from "@lore/core/schemas";
import { BayUpgrade } from "@lore/core/schemas";
import { $inject } from "alepha";
import { BadRequestError, ForbiddenError } from "alepha/server";

import { HostInventoryService } from "./HostInventoryService.ts";
import { HostService } from "./HostService.ts";

/**
 * Sends a Bay host the `upgrade` command, once everything that would make
 * it fail has been ruled out here (#E152).
 *
 * `upgrade` replaces a binary that runs as root, so it is the most powerful
 * verb of the connector. Every refusal below is decided before a row is
 * written, and Bay decides each of them again on its side: a Lore-side bug
 * must not be what stands between a browser and the binary.
 */
export class HostUpgradeService {
  protected readonly commands = $inject(HostCommandService);
  protected readonly inventories = $inject(HostInventoryService);
  protected readonly hosts = $inject(HostService);
  protected readonly target = $inject(BayReleaseTarget);

  /**
   * Queue the upgrade of a host to `version`, or to the version this Lore
   * installs when none is named.
   */
  async enqueue(
    host: Host,
    version: string | undefined,
    requestedBy?: string,
  ): Promise<HostCommand> {
    // The Cloudflare refusal and the deploy switch, in the words every other
    // gated verb uses.
    this.commands.assertAccepts(host, "upgrade");

    // An offline host is refused rather than queued, like a log tail: a root
    // binary replaced hours later, when nobody is watching, is the wrong
    // moment.
    if (!this.hosts.isOnline(host)) {
      throw new BadRequestError(
        `Host "${host.slug}" is not connected right now, so its Bay cannot be upgraded: an upgrade waits for it to be back rather than running hours later`,
      );
    }

    const inventory = await this.inventories.findFor(host.id);
    const current = inventory?.bayVersion;
    if (!BayUpgrade.isVersion(current)) {
      throw new BadRequestError(
        current
          ? `Host "${host.slug}" runs a Bay with no release version (${current}), so Lore cannot tell an upgrade from a downgrade. Install a release on the machine with install.sh`
          : `Host "${host.slug}" has not reported which Bay it runs yet`,
      );
    }

    const wanted = version ?? this.target.version();
    if (!wanted) {
      throw new BadRequestError(
        "This Lore was not built from a release, so it has no Bay version to install. Name one with a version",
      );
    }
    const order = BayUpgrade.compare(wanted, current);
    if (order === undefined) {
      throw new BadRequestError(
        `"${wanted}" is not a version: an upgrade names a release as x.y.z`,
      );
    }
    if (order < 0) {
      throw new ForbiddenError(
        `Host "${host.slug}" runs Bay ${current}, and Lore does not take a host back to ${wanted}. An older version is installed on the machine, with install.sh and BAY_VERSION=${wanted}`,
      );
    }
    if (order === 0) {
      throw new BadRequestError(
        `Host "${host.slug}" already runs Bay ${current}`,
      );
    }

    const upgradeMode = inventory?.machine.upgradeMode;
    if (upgradeMode !== "handoff") {
      throw new BadRequestError(
        `Host "${host.slug}" cannot be upgraded from Lore: ${BayUpgrade.byHandReason(upgradeMode)}. Upgrade it on the machine, once, and the next upgrade can be started from here: ${BayUpgrade.byHandCommand(wanted)}`,
      );
    }

    return this.commands.enqueue(
      host,
      {
        kind: "upgrade",
        payload: {
          app: "",
          environment: "",
          version: wanted,
          fromVersion: current,
        },
      },
      requestedBy,
    );
  }
}
