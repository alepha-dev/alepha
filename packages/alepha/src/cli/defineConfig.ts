import type { Alepha } from "alepha";
import type { CommandPrimitive } from "alepha/command";

export type AlephaCliConfig = (alepha: Alepha) => {
  commands?: Record<string, CommandPrimitive>;
};

export const defineConfig = (config: AlephaCliConfig) => {
  return (alepha: Alepha) => {
    const { commands } = config(alepha);
    return {
      ...commands,
    };
  };
};
