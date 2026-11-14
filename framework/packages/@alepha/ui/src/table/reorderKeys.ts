/**
 * Drop `key` onto `target`'s slot in `keys`: the one reorder step the kit's
 * drag-and-arrows lists share (the column picker, the admin dashboard's
 * Customize mode). A drag drops onto a slot; "move up" is a drop onto the
 * previous key, and "move down" drops the next key onto this one.
 *
 * Returns `keys` unchanged when the move is a no-op or names a missing key.
 */
export const reorderKeys = (
  keys: readonly string[],
  key: string,
  target: string,
): string[] => {
  if (key === target || !keys.includes(key) || !keys.includes(target)) {
    return [...keys];
  }
  const next = keys.filter((k) => k !== key);
  next.splice(next.indexOf(target), 0, key);
  return next;
};
