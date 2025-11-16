import { type Static, t } from "alepha";
import { files } from "../entities/files.ts";

export const fileResourceSchema = t.extend(
  files.schema,
  {},
  {
    title: "FileResource",
    description: "A file resource representing a file stored in the system.",
  },
);

export type FileResource = Static<typeof fileResourceSchema>;
