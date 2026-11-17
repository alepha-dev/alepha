/**
 * The order a list of ranks is shown in: most powerful first, as a ladder
 * (Owner, Admin, Member, Viewer), and a custom rank falls into place by how
 * much it grants. A tie is broken by name, so the order is the same on
 * every load whatever order the server answered in.
 *
 * `power` counts what a rank grants. The default is the number of stored
 * permissions, `*` counting as everything; the Ranks page passes the count
 * over the permissions its matrix shows, so a column never moves before a
 * change is saved.
 */
export const rankOrder = <
  T extends { key: string; name: string; permissions: readonly string[] },
>(
  ranks: readonly T[],
  power: (rank: T) => number = (rank) =>
    rank.permissions.includes("*")
      ? Number.POSITIVE_INFINITY
      : rank.permissions.length,
): T[] =>
  [...ranks].sort(
    (a, b) => power(b) - power(a) || a.name.localeCompare(b.name),
  );
