import type { Alepha } from "alepha";
import type { CommandPrimitive } from "alepha/command";

export type AlephaCliConfig = (alepha: Alepha) => {
  commands?: Record<string, CommandPrimitive>;
  services?: Array<any>;
};

export const defineConfig = (config: AlephaCliConfig) => {
  return (alepha: Alepha) => {
    const { commands, services = [] } = config(alepha);
    for (const it of services) {
      alepha.with(it);
    }
    return {
      ...commands,
    };
  };
};

/**
 * @alias defineConfig
 */
export const defineAlephaConfig = defineConfig;
