/**
 * What an app is made of, as `alepha build` lists it (#Q3401): its pure
 * controllers and every primitive a runtime or a reader needs without
 * creating the class that holds it.
 *
 * Written into `dist/manifest.json` (as `surface`) and baked into every
 * server slice. A class is named by {@link AppSurfaceClass.key}: its module's
 * name and its class name, the same on the build's container and on the
 * runtime's.
 */
export interface AppSurface {
  version: 1;
  classes: AppSurfaceClass[];
  actions: AppSurfaceAction[];
  routes: AppSurfaceRoute[];
  pages: AppSurfacePage[];
  jobs: AppSurfaceJob[];
  tools: AppSurfaceNamed[];
  resources: AppSurfaceNamed[];
  prompts: AppSurfaceNamed[];
}

/**
 * One class holding a table primitive.
 */
export interface AppSurfaceClass {
  /**
   * `module.name:ClassName`, or the class name alone for a class no module
   * lists.
   */
  key: string;
  pure: boolean;
  /**
   * Why it is not pure, each naming the other class or the primitive.
   */
  reasons?: string[];
  /**
   * For a pure class: the keys of the classes created only because pure
   * classes created them.
   */
  closure?: string[];
  /**
   * The permission strings this class declared through `$secure`, registered
   * at boot from the list so a late class never has to.
   */
  permissions?: string[];
}

/**
 * An `$action` or an `$sse`, with what the boot-time readers of the action
 * list take from it.
 */
export interface AppSurfaceAction {
  name: string;
  group: string;
  method: string;
  /**
   * Without the API prefix: the runtime applies it, since an app may set it
   * from its environment and one build serves many.
   */
  path: string;
  kind?: "sse";
  /**
   * The body's content type when it is not JSON.
   */
  contentType?: string;
  secured?:
    | boolean
    | {
        issuers?: string[];
        roles?: string[];
        permissions?: string[];
        sessionOnly?: boolean;
      };
  mcp?: boolean;
  class: string;
}

export interface AppSurfaceRoute {
  method: string;
  path: string;
  class: string;
}

export interface AppSurfacePage {
  name: string;
  path?: string;
  parent?: string;
  class: string;
}

export interface AppSurfaceJob {
  name: string;
  cron?: string;
  class: string;
}

export interface AppSurfaceNamed {
  name: string;
  class: string;
}
