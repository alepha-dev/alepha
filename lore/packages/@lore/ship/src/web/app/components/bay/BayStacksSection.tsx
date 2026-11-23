import type { HostInventoryResource } from "@lore/core/schemas";

import BayStacks from "./BayStacks.tsx";

export interface BayStacksSectionProps {
  inventory: HostInventoryResource["inventory"] | undefined;
}

/**
 * Ship's section of the host console's Overview (#E166): the stacks the
 * machine reports, when it reports any.
 */
const BayStacksSection = (props: BayStacksSectionProps) =>
  props.inventory?.stacks?.length ? (
    <BayStacks stacks={props.inventory.stacks} />
  ) : null;

export default BayStacksSection;
