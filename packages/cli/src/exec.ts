import { spawn } from "node:child_process";

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
