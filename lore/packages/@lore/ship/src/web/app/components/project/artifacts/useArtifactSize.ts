import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

/**
 * Bytes as the rest of the Artifacts surfaces print them, with an optional
 * sign for a delta.
 */
export const useArtifactSize = () => {
  const { l } = useI18n<I18n, "en">();

  return (bytes: number, options?: { signed?: boolean }): string => {
    const sign = options?.signed && bytes > 0 ? "+" : "";
    return `${sign}${l(bytes / 1_000_000, {
      number: { maximumFractionDigits: 1 },
    })} MB`;
  };
};
