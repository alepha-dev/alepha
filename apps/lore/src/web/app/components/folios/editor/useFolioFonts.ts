import { useEffect } from "react";

const LINK_ID = "lore-folio-fonts";
const HREF = "/fonts/folio.css";

/**
 * Lazy-loads the folio workspace's typography (Literata + JetBrains Mono)
 * the first time a folio editor mounts. Idempotent: the stylesheet is
 * injected once per document and never removed, matching how ThemePicker
 * loads a theme's display font.
 *
 * Deliberately not imported from `main.css` — every page would then pay
 * for two font families only the folio surface uses.
 */
export const useFolioFonts = (): void => {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(LINK_ID)) return;
    const link = document.createElement("link");
    link.id = LINK_ID;
    link.rel = "stylesheet";
    link.href = HREF;
    document.head.appendChild(link);
  }, []);
};
