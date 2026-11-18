import { useStore } from "alepha/react";
import { useEffect } from "react";

import {
  type RequirementsCountKey,
  requirementsCountsAtom,
} from "../../atoms/requirementsCountsAtom.ts";

/**
 * Keeps a sidebar count in step with a full list a page already holds, so a
 * create or a delete moves the count without another request. `undefined`
 * (not loaded yet) writes nothing.
 */
export const useSyncRequirementsCount = (
  key: RequirementsCountKey,
  list: readonly unknown[] | undefined,
): void => {
  const [counts, setCounts] = useStore(requirementsCountsAtom);
  const length = list?.length;
  useEffect(() => {
    if (length === undefined || counts?.[key] === length) return;
    setCounts({ ...counts, [key]: length });
  }, [key, length, counts, setCounts]);
};
