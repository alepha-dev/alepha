import { $context } from "alepha";
import { AdminRouter } from "../AdminRouter.ts";

export const $adminPage = () => {
  const { alepha } = $context();
  return alepha.inject(AdminRouter);
};
