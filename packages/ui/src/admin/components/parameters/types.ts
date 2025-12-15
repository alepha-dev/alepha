import type { Parameter } from "alepha/api/parameters";

export interface ConfigValue {
  current?: Parameter;
  next?: Parameter;
  /** Default value from the registered $config primitive */
  defaultValue?: unknown;
  /** Current in-memory value (may be default if never saved) */
  currentValue?: unknown;
  /** TypeBox/JSON schema for the configuration (as JSON from API) */
  schema?: Record<string, unknown>;
}

export const getStatusColor = (status: string) => {
  switch (status) {
    case "current":
      return "green";
    case "next":
      return "blue";
    case "future":
      return "cyan";
    case "expired":
      return "gray";
    default:
      return "gray";
  }
};

export const formatJson = (obj: unknown): string => {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
};
