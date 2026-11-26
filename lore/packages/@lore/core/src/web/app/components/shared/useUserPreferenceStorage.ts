import {
  DATA_TABLE_PERSISTED_SUFFIXES,
  type DataTablePersistenceStorage,
  localStorageDataTableStorage,
} from "@alepha/ui/table";
import { useClient, useQuery } from "alepha/react";
import { useEffect, useRef } from "react";

import type { UserPreferenceController } from "../../../../api/controllers/UserPreferenceController.ts";
import type { UserPreferenceResource } from "../../../../api/schemas/userPreferenceSchema.ts";

/**
 * How long a burst of writes (typing in the search, dragging a column) waits
 * before it is saved, as one request carrying the last state.
 */
const SAVE_DELAY_MS = 500;

/**
 * How long a failed save waits before its one retry.
 */
const RETRY_DELAY_MS = 5_000;

/**
 * The last save sent for each key, settled or not.
 *
 * Every save of a key chains on this one, so two saves of the same key land
 * in the order they were made; and a read of the key waits for it, so a table
 * mounted again right after it unmounted (its flush still in flight) reads
 * what it just wrote rather than the state before.
 */
const savesInFlight = new Map<string, Promise<void>>();

/**
 * Where a state not yet saved waits in this browser, beside the table's own
 * facets in `localStorage` (and not one of them, so it is never carried over
 * as one).
 *
 * A save is debounced and a page that navigates away, reloads or closes
 * cancels the request it was flushing; without this copy the change would be
 * lost and the next visit would open on the state before it. It is cleared
 * once the server holds it, and a mount that finds it saves it first.
 */
const UNSAVED_SUFFIX = "unsaved";

/**
 * A DataTable storage over one user preference (#Q4417): the table's facets
 * (`filters`, `sort`, `columns`...) are the fields of one JSON object stored
 * on the server under `key`.
 *
 * Synchronous, as `DataTablePersistenceStorage` must be: it answers from
 * `values`, loaded before the table mounts, and every write changes them at
 * once and hands the whole object to `save`. A key other than its own goes
 * to `localStorage`, as it would without this storage.
 */
export const createUserPreferenceStorage = (
  key: string,
  initial: Record<string, unknown>,
  save: (value: Record<string, unknown>) => void,
): DataTablePersistenceStorage => {
  let values = { ...initial };
  return {
    read: (readKey, suffix) =>
      readKey === key
        ? values[suffix]
        : localStorageDataTableStorage.read(readKey, suffix),
    write: (writeKey, suffix, value) => {
      if (writeKey !== key) {
        localStorageDataTableStorage.write(writeKey, suffix, value);
        return;
      }
      const next = { ...values };
      if (value === undefined) delete next[suffix];
      else next[suffix] = value;
      values = next;
      save(values);
    },
  };
};

/**
 * What this browser still holds for `key` from before the table's state went
 * to the server: every facet a DataTable stores, read from `localStorage`.
 * `undefined` when there is none.
 */
export const legacyTableState = (
  key: string,
): Record<string, unknown> | undefined => {
  const found: Record<string, unknown> = {};
  for (const suffix of DATA_TABLE_PERSISTED_SUFFIXES) {
    const value = localStorageDataTableStorage.read(key, suffix);
    if (value !== undefined) found[suffix] = value;
  }
  return Object.keys(found).length > 0 ? found : undefined;
};

const forgetLegacyTableState = (key: string) => {
  for (const suffix of DATA_TABLE_PERSISTED_SUFFIXES) {
    localStorageDataTableStorage.write(key, suffix, undefined);
  }
};

export interface UserPreferenceStorage {
  /**
   * The storage to hand the table as `persistenceStorage`, once `ready`.
   */
  storage: DataTablePersistenceStorage;
  /**
   * Whether the preference has loaded, or failed to and fell back to
   * `localStorage`. Mount the table only then: it reads its state once, on
   * mount, and a table mounted before would open on its defaults. Once true
   * for a key it stays true for it, whatever the read does after.
   */
  ready: boolean;
}

/**
 * A DataTable's state kept in the signed-in user's preferences on the
 * server, under the table's `persistenceKey` (#Q4417), so it follows them to
 * another device.
 *
 * - **First paint.** The preference is read once per mount, before the table
 *   mounts (`ready`), so the table opens on the saved state with no flash of
 *   its defaults. No shared query cache: every mount reads the server, which
 *   is what picks up a change made on another device, and a cached copy
 *   could not come back over a newer write.
 * - **Writes** are saved after {@link SAVE_DELAY_MS} of quiet, the whole
 *   object at once, one key's saves in order, and flushed when the table goes
 *   away or the page is hidden. Until the server holds a change, a copy of it
 *   waits in this browser ({@link UNSAVED_SUFFIX}), so a reload or a closed
 *   tab that cancelled the save does not lose it: the next mount opens on it
 *   and saves it. A failed save is retried once.
 * - **Carried over once.** A key never written on the server takes what this
 *   browser kept in `localStorage` under it and saves it. Whatever this
 *   browser kept is removed once the server holds the key, so it is never
 *   read again.
 * - **No session, or a failed read**: the table falls back to `localStorage`,
 *   exactly as without this hook, for as long as it stays mounted.
 *
 * Key the table on `key` too: the storage belongs to one key. An undefined
 * `key` (no project yet) reads nothing and is never `ready`.
 */
export const useUserPreferenceStorage = (
  key: string | undefined,
): UserPreferenceStorage => {
  const api = useClient<UserPreferenceController>();
  const query = useQuery<UserPreferenceResource>(
    {
      enabled: key !== undefined,
      // Once the table is mounted on what was read, a later read changes
      // nothing it shows: no refetch to unmount it for.
      refetchOnReconnect: false,
      refetchOnFocus: false,
      handler: async () => {
        // The save this browser just made, so the read sees it.
        await savesInFlight.get(key as string);
        return api.getMyPreference({ params: { key: key as string } });
      },
      // A failed read falls back to `localStorage`, below: nothing to toast.
      onError: () => {},
    },
    [api, key],
  );

  // The last state waiting to be saved, with the key it belongs to: a flush
  // that runs after the key changed still saves it where it was written.
  const pending = useRef<
    { key: string; value: Record<string, unknown> } | undefined
  >(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * A plain client call, not a `useAction`, on purpose: a save has to outlive
   * the table (the flush on unmount and on a hidden page), and one key's
   * saves are chained so they land in order, where `useAction` drops a run
   * while another is in flight and aborts it on unmount. A failure is
   * retried once and never toasted: the table keeps working on what it holds.
   */
  const send = useRef(
    (
      _key: string,
      _value: Record<string, unknown>,
      _retry: boolean,
    ): Promise<boolean> => Promise.resolve(false),
  );
  send.current = (saveKey, value, retry) => {
    const previous = savesInFlight.get(saveKey) ?? Promise.resolve();
    const settled = previous
      .then(() =>
        api.setMyPreference({ params: { key: saveKey }, body: { value } }),
      )
      .then(
        () => true,
        () => {
          // Not retried when a newer state is already waiting: that one
          // carries this one's change with it.
          if (retry && pending.current?.key !== saveKey) {
            setTimeout(
              () => void send.current(saveKey, value, false),
              RETRY_DELAY_MS,
            );
          }
          return false;
        },
      );
    // Saved: the copy waiting in this browser goes, unless a newer state
    // replaced it meanwhile.
    void settled.then((ok) => {
      if (
        ok &&
        JSON.stringify(
          localStorageDataTableStorage.read(saveKey, UNSAVED_SUFFIX),
        ) === JSON.stringify(value)
      ) {
        localStorageDataTableStorage.write(saveKey, UNSAVED_SUFFIX, undefined);
      }
      return ok;
    });
    const done = settled.then(() => undefined);
    savesInFlight.set(saveKey, done);
    void done.then(() => {
      if (savesInFlight.get(saveKey) === done) savesInFlight.delete(saveKey);
      return undefined;
    });
    return settled;
  };

  const flush = useRef(() => {});
  flush.current = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    const next = pending.current;
    pending.current = undefined;
    if (next) void send.current(next.key, next.value, true);
  };

  const loaded =
    key !== undefined && query.data !== undefined && query.data.key === key;
  const failed =
    key !== undefined && !loaded && !query.loading && query.error !== undefined;

  // Built once per key, the first render the read has settled, and kept: the
  // table reads it on mount, and nothing read after may replace it.
  const built = useRef<
    | {
        key: string;
        storage: DataTablePersistenceStorage;
        carry?: Record<string, unknown>;
        legacy: boolean;
      }
    | undefined
  >(undefined);
  if (built.current && built.current.key !== key) built.current = undefined;
  if (!built.current && key !== undefined && (loaded || failed)) {
    const saveKey = key;
    const save = (value: Record<string, unknown>) => {
      pending.current = { key: saveKey, value };
      localStorageDataTableStorage.write(saveKey, UNSAVED_SUFFIX, value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush.current(), SAVE_DELAY_MS);
    };
    const saved = loaded ? query.data?.value : undefined;
    const legacy = loaded ? legacyTableState(key) : undefined;
    // A change this browser made and never got saved (the page went away
    // first): newer than anything the server holds.
    const unsavedValue = loaded
      ? localStorageDataTableStorage.read(key, UNSAVED_SUFFIX)
      : undefined;
    const unsaved =
      unsavedValue !== null &&
      typeof unsavedValue === "object" &&
      !Array.isArray(unsavedValue)
        ? (unsavedValue as Record<string, unknown>)
        : undefined;
    built.current = !loaded
      ? { key, storage: localStorageDataTableStorage, legacy: false }
      : {
          key,
          storage: createUserPreferenceStorage(
            key,
            unsaved ?? saved ?? legacy ?? {},
            save,
          ),
          // What the server lacks goes there: the unsaved change, or, for a
          // key never written, what this browser kept.
          carry: unsaved ?? (saved ? undefined : legacy),
          legacy: legacy !== undefined,
        };
  }
  const current = built.current;

  // The carry-over, once per key, after the render that read it. Through
  // `send`, so it is ordered before any save the table makes after.
  const carried = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!current || carried.current === current.key) return;
    carried.current = current.key;
    const legacyKey = current.key;
    if (current.carry) {
      // Forgotten once the server holds it: a failed carry leaves it for
      // the next visit.
      void send.current(legacyKey, current.carry, true).then((ok) => {
        if (ok && current.legacy) forgetLegacyTableState(legacyKey);
        return ok;
      });
    } else if (current.legacy) {
      // The server already held the key: what this browser kept is a
      // leftover from before, never read again.
      forgetLegacyTableState(legacyKey);
    }
  }, [current]);

  useEffect(() => {
    const onHide = () => flush.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush.current();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flush.current();
    };
  }, [key]);

  return {
    storage: current?.storage ?? localStorageDataTableStorage,
    ready: current !== undefined,
  };
};
