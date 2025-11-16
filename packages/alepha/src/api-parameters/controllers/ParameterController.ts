import { $action } from "alepha/server";

export class ParameterController {
  /**
- List all configs
- List all parameter versions of one config
- List current active parameters of one config
- Create new parameter version for one config, with future date or immediate
- Rollback to previous parameter version (creates new version with previous content)
- Activate future parameter version immediately (creates new version with future content)
	 */

  getAllConfigs = $action({
    path: "/configs",
    method: "GET",
    handler: async () => {
      // Implementation goes here
    },
  });

  getAllParameters = $action({
    path: "/parameters",
    schema: {
      // query: name
    },
    method: "GET",
    handler: async ({ params }) => {
      const { configName } = params;
      // Implementation goes here
    },
  });

  getParametersByName = $action({
    description: "Get current active parameters for a specific configuration.",
    path: "/parameters/:name",
    method: "GET",
    schema: {
      // response: { current: ..., next?: ... }
    },
    handler: async ({ params }) => {
      const { configName } = params;
      // Implementation goes here
    },
  });
}
