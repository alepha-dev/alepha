import { t } from "alepha";

/**
 * Lightweight folio reference returned by list/search tools.
 */
export const folioRefSchema = t.object({
  id: t.uuid(),
  title: t.string(),
  tags: t.array(t.string()),
  updatedAt: t.string(),
});

/**
 * Full folio payload returned by get/create/update tools.
 */
export const folioFullSchema = t.object({
  id: t.uuid(),
  title: t.string(),
  tags: t.array(t.string()),
  content: t.string(),
  createdAt: t.string(),
  updatedAt: t.string(),
});
