import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const okSchema = t.object(
	{
		ok: t.boolean({ description: "True when operation succeed" }),
		id: t.optional(t.union([t.text(), t.int()])),
		count: t.optional(
			t.number({ description: "Number of resources affected" }),
		),
	},
	{
		title: "Ok",
		description: "Generic response after a successful operation on a resource",
	},
);

export type Ok = Static<typeof okSchema>;
