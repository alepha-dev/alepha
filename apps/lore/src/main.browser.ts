import { Alepha, run } from "alepha";
import { LoreWebAdmin } from "@/web/admin/index.ts";
import { LoreWebApp } from "./web/app/index.ts";

const alepha = Alepha.create();

alepha.with(LoreWebApp);
alepha.with(LoreWebAdmin);

run(alepha);

/**
 * Quest #90 — Lore dogfoods its own crash reporting.
 *
 * `VITE_LORE_SELF_SIGIL` is baked at build time (see `alepha.config.ts`'s
 * `env` block) and points at the Lore-self sigil seeded on campaign #2.
 * On app start we inject `/sigils/<id>/embed.js` — the exact embed script a
 * third-party site would load — so uncaught exceptions on `lore.alepha.dev`
 * land in campaign #2's Blights inbox.
 *
 * The route is `/sigils/:id/embed.js`, NOT `/sigils/:id.js` (the Alepha trie
 * router cannot match a literal `.js` suffix on a param segment — see
 * `SigilEmbedController`).
 *
 * Guarded: when the env var is empty/unset (dev, or a deploy that did not
 * bake it) nothing is loaded.
 */
const loreSelfSigil = import.meta.env.VITE_LORE_SELF_SIGIL;
if (alepha.isProduction() && loreSelfSigil) {
  const script = document.createElement("script");
  script.src = `/sigils/${encodeURIComponent(loreSelfSigil)}/embed.js`;
  script.async = true;
  (document.head || document.documentElement).appendChild(script);
}
