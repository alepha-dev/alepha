import type { ZObject } from "alepha";
import { useAlepha } from "alepha/react";
import { useRouter, useRouterState } from "alepha/react/router";
import { useEffect, useRef } from "react";
import type { FormModel } from "../services/FormModel.ts";

export interface UseFormQuerySyncOptions<TKey extends string> {
  /**
   * Form field keys to mirror to/from the URL query. Fields not listed
   * here stay local to the form and never leak into the address bar.
   */
  keys: readonly TKey[];
}

/**
 * Two-way bind a `useForm` instance to the URL query params, keyed
 * per-field (so the URL stays human-readable: `?status=new&zone=ops`).
 *
 * Direction 1 - URL → form:
 * - On mount AND every time one of the watched query keys changes
 *   (typically via browser back/forward or external `router.push`),
 *   call `form.input[key].set(value)` for each listed key. Missing /
 *   empty params clear the field (set to `undefined`).
 *
 * Direction 2 - form → URL:
 * - Subscribe to the form's `form:change` event for the listed keys.
 *   Each emission writes the current values for all listed keys to the
 *   URL via `router.setQueryParams` (replace-state, no history spam).
 *   Empty values (`undefined` / `""`) are stripped from the URL so the
 *   address bar stays clean.
 *
 * Replaces ad-hoc `localStorage` filter persistence: the URL becomes
 * the canonical store, so the view is shareable via copy-paste and
 * navigable via back/forward.
 *
 * @example
 * const form = useForm({ schema: z.object({ status: z.string(), q: z.string() }) });
 * useFormQuerySync(form, { keys: ["status", "q"] });
 */
export const useFormQuerySync = <T extends ZObject, TKey extends string>(
  form: FormModel<T>,
  options: UseFormQuerySyncOptions<TKey>,
): void => {
  const alepha = useAlepha();
  const router = useRouter();
  const state = useRouterState();
  const keys = options.keys;

  // URL → form. Recompute a stable signature of the watched slice of
  // router.query so the effect fires precisely when it changes.
  const querySig = keys
    .map((k) => {
      const raw = state.query?.[k];
      return typeof raw === "string" ? raw : "";
    })
    .join("\u0000");

  // First-mount semantics differ from later URL changes: when the URL
  // is empty AND the form has an initial value (e.g. status: "new"),
  // preserve that initial value — and write it back to the URL so the
  // URL becomes the source of truth from then on. Without this guard
  // the mount would clear the form's defaults, defeating the whole
  // "default lane" pattern.
  const initialized = useRef(false);
  useEffect(() => {
    const isFirstRun = !initialized.current;
    initialized.current = true;
    const values = (form as unknown as { currentValues: Record<string, any> })
      .currentValues;
    const missingInitials: Record<string, string> = {};
    for (const key of keys) {
      const raw = state.query?.[key];
      const next = typeof raw === "string" && raw !== "" ? raw : undefined;
      const current = values[key];
      if (
        isFirstRun &&
        next === undefined &&
        current != null &&
        current !== ""
      ) {
        // URL missing this key on first mount but the form has a
        // default — keep the default, queue it to be written below.
        missingInitials[key] = String(current);
        continue;
      }
      // Skip when already in sync — avoids bouncing form:change ↔
      // setQueryParams and re-triggering subscribers.
      if ((current ?? undefined) !== next) {
        const input = (form.input as Record<string, any>)[key];
        if (input && typeof input.set === "function") {
          input.set(next);
        }
      }
    }
    if (isFirstRun && Object.keys(missingInitials).length > 0) {
      // Merge with whatever URL params ARE present so we don't clobber
      // unrelated keys the page also uses — the updater form receives the
      // current query, so params this form doesn't own survive.
      router.setQueryParams((current: Record<string, any>) => ({
        ...current,
        ...missingInitials,
      }));
    }
    // querySig is the meaningful trigger; form/keys/router are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySig]);

  // form → URL. Listen for changes on the watched keys only.
  useEffect(() => {
    if (!alepha.isBrowser()) return;
    const off = alepha.events.on("form:change", (e: any) => {
      if (e.id !== form.id) return;
      // `FormModel` always slash-prefixes the path (`/status`), while `keys`
      // holds bare field names.
      const path = typeof e.path === "string" ? e.path.replace(/^\//, "") : "";
      if (!keys.includes(path as TKey)) return;

      const values = (form as unknown as { currentValues: Record<string, any> })
        .currentValues;

      // Replace-state (default) — filters shouldn't pollute history.
      router.setQueryParams((current: Record<string, any>) => {
        // Merge: the page owns query params this form knows nothing about.
        const next: Record<string, any> = { ...current };
        for (const key of keys) {
          const value = values[key];
          if (value != null && value !== "") {
            next[key] = String(value);
          } else {
            delete next[key];
          }
        }
        return next;
      });
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alepha, form, router]);
};
