import { type Infer, z } from "alepha";

import { hostInventoryUnitSchema } from "./hostInventoryUnitSchema.ts";

/**
 * The machine itself, in absolute units, wire format v1.
 *
 * ⚠️ Every field is optional, and that is load-bearing rather than lazy. Bay
 * reads each of these independently, degrading one unreadable `/proc` file to
 * an absent field; a required field here would turn a container without
 * `/proc/loadavg` into a machine that reports nothing at all.
 *
 * Absent is not zero, on either side. The console says "not reported" for a
 * field it did not get, and "0 B of 0 B" for one it invented.
 *
 * Percentages are deliberately not here: the `stats` frame carries those for
 * the host list badge and the series, and this frame carries the bytes the
 * badge cannot produce.
 */
export const hostInventoryMachineSchema = z.object({
  cores: z.integer().min(0).max(4096).optional(),
  memTotalBytes: z.integer().min(0).optional(),
  memUsedBytes: z.integer().min(0).optional(),
  diskTotalBytes: z.integer().min(0).optional(),
  diskUsedBytes: z.integer().min(0).optional(),
  /** The one-minute load average, unbounded above: it is a queue length, not a share. */
  load1: z.number().min(0).optional(),
  uptimeSeconds: z.integer().min(0).optional(),
  /**
   * The systemd units the host watches (`watchUnits`), as last read (#Q4421).
   * Bounded like the list Lore sends.
   */
  units: z.array(hostInventoryUnitSchema).max(20).optional(),
  bayVersion: z.string().max(100).optional(),
  /**
   * Whether this Bay can take an `upgrade`: `handoff`, `restart` or `manual`
   * (`BAY_UPGRADE_MODES`). Absent from a Bay older than the command, which is
   * how Lore knows it cannot take it: no version number decides.
   *
   * A bounded string and not an enum, on purpose: a mode a later Bay adds
   * must not make Lore refuse the whole inventory of that machine.
   */
  upgradeMode: z.string().max(20).optional(),
  /**
   * `monitor` for a Bay that only reports (`bay agent`, #Q4002): no listener,
   * no Docker, and every command refused on the machine. Absent for a Bay
   * that serves. Bounded, not an enum, for the reason `upgradeMode` gives.
   */
  mode: z.string().max(20).optional(),
});

export type HostInventoryMachine = Infer<typeof hostInventoryMachineSchema>;
