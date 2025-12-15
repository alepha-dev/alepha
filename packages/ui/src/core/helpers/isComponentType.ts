import { type ComponentType, isValidElement } from "react";

export function isComponentType(param: any): param is ComponentType<any> {
  if (isValidElement(param)) return false;
  return (
    typeof param === "function" ||
    (typeof param === "object" && param !== null && "$$typeof" in param)
  );
}
