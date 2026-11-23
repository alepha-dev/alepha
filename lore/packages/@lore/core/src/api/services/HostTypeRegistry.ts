import { AlephaError } from "alepha";

import type { Host } from "../entities/hosts.ts";

/**
 * What a host type does beyond what every host has (#E166, folio #F1537):
 * the credential a `cloudflare` account carries, checked, masked and
 * rechecked by Ship's `HostCloudflareService`. A `bay` is core's and needs
 * nothing here.
 *
 * Filled app-wide, never per project, and gated on no capability: every
 * registered type can be created in any project, Ship on or off, since a
 * project may exist only to store hosts and lend them (review item 14).
 *
 * With nothing registered for a type, its credential has no status, masks
 * to nothing and is never checked.
 */
export class HostTypeRegistry {
  protected readonly behaviours = new Map<string, HostTypeBehaviour>();

  public register(type: string, behaviour: HostTypeBehaviour): void {
    if (this.behaviours.has(type)) {
      throw new AlephaError(`Host type '${type}' already has a behaviour`);
    }
    this.behaviours.set(type, behaviour);
  }

  public has(type: string): boolean {
    return this.behaviours.has(type);
  }

  public credentialStatus(host: Host): "valid" | "invalid" | undefined {
    return this.behaviours.get(host.type)?.credentialStatus(host);
  }

  public mask(type: string, token: string): string | undefined {
    return this.behaviours.get(type)?.mask(token);
  }

  /**
   * Ask the provider whether a credential works, before it is stored.
   * Refused when the type has no credential to check.
   */
  public async check(
    type: string,
    input: { accountId: string; token: string },
  ): Promise<HostCredentialCheck> {
    return this.require(type).check(input);
  }

  /**
   * Check a stored credential again, writing what the provider said.
   */
  public async recheck(host: Host): Promise<HostCredentialCheck> {
    return this.require(host.type).recheck(host);
  }

  protected require(type: string): HostTypeBehaviour {
    const behaviour = this.behaviours.get(type);
    if (!behaviour) {
      throw new AlephaError(`Host type '${type}' has no credential to check`);
    }
    return behaviour;
  }
}

export interface HostTypeBehaviour {
  credentialStatus: (host: Host) => "valid" | "invalid" | undefined;
  mask: (token: string) => string;
  check: (input: {
    accountId: string;
    token: string;
  }) => Promise<HostCredentialCheck>;
  recheck: (host: Host) => Promise<HostCredentialCheck>;
}

/**
 * The field a refused credential is about, so the dialog (#1865) can render
 * the message against the account id or the token rather than as a toast.
 */
export type HostCredentialField = "accountId" | "token";

/**
 * What Lore knows about a credential after asking its provider.
 *
 * Three answers, not two. **A transport failure is no verdict**: a network
 * error, a timeout, a `5xx` or a `429` means Lore does not know, and "does
 * not know" must never be written to a row as "invalid", or a provider
 * outage at midnight would flip every host at once and email every owner.
 */
export type HostCredentialCheck =
  | { outcome: "passed"; expiresAt?: string }
  | { outcome: "failed"; message: string; field: HostCredentialField }
  | { outcome: "inconclusive"; message: string };
