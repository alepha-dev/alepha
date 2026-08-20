import { useEffect } from "react";

const LINK_ID = "lore-folio-fonts";
const HREF = "/fonts/folio.css";

/**
 * Lazy-loads the reading typography (Literata + JetBrains Mono) the first
 * time a surface that sets prose in it mounts. Idempotent: the stylesheet is
 * injected once per document and never removed, matching how ThemePicker
 * loads a theme's display font.
 *
 * Deliberately not imported from `main.css` — every page would then pay for
 * two font families only the reading surfaces use.
 *
 * Two callers: the folio workspace, and the quest page (whose description is
 * set in the same face). The stylesheet id is still `lore-folio-fonts` and
 * the file is still `/fonts/folio.css` — both are just names, and changing
 * them would only churn the public asset path.
 */
export const useReadingFonts = (): void => {
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
