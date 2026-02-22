import type { ParameterResponse } from "alepha/api/parameters";

export interface ParameterValue {
  current?: ParameterResponse;
  next?: ParameterResponse;
  /**
   * Default value from the registered $parameter primitive.
   */
  defaultValue?: unknown;
  /**
   * Current in-memory value (may be default if never saved).
   */
  currentValue?: unknown;
  /**
   * TypeBox/JSON schema for the parameter (as JSON from API).
   */
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
