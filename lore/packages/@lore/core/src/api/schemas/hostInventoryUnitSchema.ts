import { type Infer, z } from "alepha";

/**
 * One systemd unit a host was asked to watch, as Bay last read it (#Q4421):
 * the services an operator cares about on a machine Bay does not run.
 *
 * `activeState` is systemd's (`active`, `activating`, `deactivating`,
 * `inactive`, `failed`, `reloading`) or `not-found`. A bounded string and not
 * an enum, for the reason `upgradeMode` gives: a state a later systemd adds
 * must not make Lore refuse the whole inventory.
 */
export const hostInventoryUnitSchema = z.object({
  name: z.string().max(200),
  activeState: z.string().max(40),
  subState: z.string().max(40).optional(),
  /** When the unit entered its current state, RFC 3339. */
  since: z.string().max(40).optional(),
});

export type HostInventoryUnit = Infer<typeof hostInventoryUnitSchema>;
