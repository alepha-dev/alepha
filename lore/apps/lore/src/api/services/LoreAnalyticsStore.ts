import { createOrmAnalyticsStore } from "@alepha/sigil/ingest";
import { sigilAnalytics } from "../entities/sigilAnalytics.ts";

/**
 * Where Lore's sigil analytics live: the package's relational store, closed
 * over this app's own entities.
 *
 * A named subclass rather than the factory's return value used inline, because
 * DI resolves by class identity — `alepha.inject(...)` needs something stable
 * to key on, and a second call to the factory would produce a second class and
 * therefore a second instance.
 *
 * It is also the substitution point. Everything that writes or reads analytics
 * goes through `AnalyticsStore`, so swapping this line is how Lore would move
 * views and vitals onto Workers Analytics Engine without any caller knowing.
 */
export class LoreAnalyticsStore extends createOrmAnalyticsStore(
  sigilAnalytics,
) {}
