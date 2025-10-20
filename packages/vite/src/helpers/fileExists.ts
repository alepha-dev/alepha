import { access } from "node:fs/promises";
import { join } from "node:path";

export const fileExists = async (path: string): Promise<boolean> => {
  return await access(join(process.cwd(), path))
    .then(() => true)
    .catch(() => false);
};
