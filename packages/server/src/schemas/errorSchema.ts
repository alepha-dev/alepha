import { t } from "@alepha/core";

export const errorSchema = t.object(
	{
		statusCode: t.uint({
			description: "HTTP status code",
		}),
		error: t.string({ description: "HTTP error name" }),
		code: t.optional(t.string({ description: "Error code name" })),
		message: t.string({ description: "Short text which describe the error" }),
	},
	{
		title: "HttpError",
		description: "Generic response after a failed operation",
	},
);
