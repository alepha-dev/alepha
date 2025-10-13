import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { pageQuerySchema } from "@alepha/postgres";

export const fileQuerySchema = t.interface([pageQuerySchema], {
	bucket: t.optional(t.string()),
	tags: t.optional(t.array(t.string())),
});

export type FileQuery = Static<typeof fileQuerySchema>;
