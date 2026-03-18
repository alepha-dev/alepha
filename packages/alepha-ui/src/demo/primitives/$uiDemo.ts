import { $context } from "alepha";
import { DemoRouter } from "../DemoRouter.ts";

/**
 * Register Demo UI components and get the DemoRouter instance.
 */
export const $uiDemo = () => {
  const { alepha } = $context();
  return alepha.inject(DemoRouter);
};
