import type { Static } from "@alepha/core";
import { files } from "../entities/files.ts";

export const fileResourceSchema = files.$schema;

export type FileResource = Static<typeof fileResourceSchema>;
