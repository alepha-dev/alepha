import { $inject } from "alepha";

import { DeployRouter } from "./DeployRouter.ts";
import { KnowledgeRouter } from "./KnowledgeRouter.ts";
import { WorkRouter } from "./WorkRouter.ts";

/**
 * The page tree of the whole app, for what still asks for it in one piece
 * (the entries and the route specs): core's pages are `CoreRouter`'s, and
 * each module's are its own router's (#E75), mounted with `parent:`.
 */
export class AppRouter {
  work = $inject(WorkRouter);
  knowledge = $inject(KnowledgeRouter);
  deploy = $inject(DeployRouter);
}
