import { t } from "@alepha/core";
import {
  PG_DEFAULT,
  PG_PRIMARY_KEY,
  PG_SERIAL,
} from "../constants/PG_SYMBOLS.ts";
import { pgAttr } from "../helpers/pgAttr.ts";

/**
 * @deprecated Use `pg.primaryKey()` instead.
 */
export const legacyIdSchema = pgAttr(
  pgAttr(pgAttr(t.int(), PG_PRIMARY_KEY), PG_SERIAL),
  PG_DEFAULT,
);
