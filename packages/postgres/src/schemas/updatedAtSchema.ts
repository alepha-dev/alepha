import { t } from "@alepha/core";
import { PG_DEFAULT, PG_UPDATED_AT } from "../constants/PG_SYMBOLS.ts";
import { pgAttr } from "./pgAttr.ts";

/**
 *
 */
export const updatedAtSchema = pgAttr(
	pgAttr(t.datetime(), PG_UPDATED_AT),
	PG_DEFAULT,
);
