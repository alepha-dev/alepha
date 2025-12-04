import { type Static, t } from "alepha";

export const searchQuerySchema = t.object({
  from: t.text(),
  to: t.text(),
  date: t.text(),
});

export type SearchQuery = Static<typeof searchQuerySchema>;
