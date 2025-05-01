import { t } from "@alepha/core";
import { PG_DEFAULT, PG_UPDATED_AT } from "../constants/PG_SYMBOLS";
import { pgAttr } from "./pgAttr";

/**
 *
 */
export const updatedAtSchema = pgAttr(
	pgAttr(t.datetime(), PG_UPDATED_AT),
	PG_DEFAULT,
);
