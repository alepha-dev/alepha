import { CoreTestEntities } from "@lore/core/testing";

/**
 * Deploy's repository bag (#E75, #Q2614): core's tables, constructed before
 * `start()`. Deploy's own tables (estates, sigils, instances) carry no
 * foreign key a core helper would trip over, so each spec registers the ones
 * it reads in its own bag.
 */
export class DeployTestEntities extends CoreTestEntities {}
