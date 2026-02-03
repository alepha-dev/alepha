import { $context } from "alepha";
import { AuthRouter } from "../AuthRouter.ts";

/**
 * Register Auth UI components and get the AuthRouter instance.
 */
export const $uiAuth = () => {
  const { alepha } = $context();
  return alepha.inject(AuthRouter);
};
