import { type Static, t } from "@alepha/core";
import { files } from "../entities/files.ts";

export const fileResourceSchema = t.interface(
	[files.$schema],
	{},
	{
		title: "FileResource",
		description: "A file resource representing a file stored in the system.",
	},
);

export type FileResource = Static<typeof fileResourceSchema>;
