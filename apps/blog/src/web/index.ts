import { $module } from "alepha";
import { AppRouter } from "./AppRouter.ts";

export const BlogWeb = $module({
  name: "blog.web",
  services: [AppRouter],
});
