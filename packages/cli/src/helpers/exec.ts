import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const exec = async (command: string): Promise<void> => {
  const prog = spawn("npx", command.split(" "), {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  await new Promise<void>((resolve) =>
    prog.on("exit", () => {
      resolve();
    }),
  );
};

export const writeConfigFile = async (
  name: string,
  content: string,
  root = process.cwd(),
) => {
  const dir = join(root, "node_modules", ".alepha");

  await mkdir(dir, {
    recursive: true,
  }).catch(() => null);

  const path = join(dir, name);
  await writeFile(path, content);

  return path;
};
