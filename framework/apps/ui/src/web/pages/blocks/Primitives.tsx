import {
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui";
import { Ellipsis, Info } from "lucide-react";

import { Group } from "@/web/components/Group.tsx";
import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The primitives whose behaviour is LAYOUT or TIMING, which no jsdom spec can
 * see: jsdom lays nothing out and opens no popup (#F1208). `blocks.spec.ts`
 * pins both specimens here, so a change to either primitive shows up as a red
 * e2e rather than as a report.
 *
 * - The tooltip waits before it opens. `TooltipProvider` sets 600ms, where 0
 *   fired a tooltip the instant a pointer crossed a trigger.
 * - The dropdown menu is `w-auto max-w-(--available-width)`, not as wide as
 *   its trigger: a menu is not a select, and a 32px icon trigger used to wrap
 *   every label.
 * - The collapsible panel animates its height to its content's, measured by
 *   Base UI, and leaves the DOM once closed.
 */
const Primitives = () => (
  <Showcase
    id="blocks/Primitives"
    title="Primitives"
    description="A tooltip, a dropdown menu and a collapsible, as the kit lays them out."
    center
  >
    {() => (
      <div className="grid gap-8">
        <Group title="Tooltip">
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="outlined" data-testid="primitives-tooltip">
                    <Info /> Hover me
                  </Button>
                }
              />
              <TooltipContent>Opens after the provider's delay</TooltipContent>
            </Tooltip>
          </div>
        </Group>

        <Group title="Dropdown menu">
          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outlined"
                    size="icon"
                    aria-label="More actions"
                    data-testid="primitives-menu"
                  />
                }
              >
                <Ellipsis />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Project</DropdownMenuLabel>
                  <DropdownMenuItem>Rename</DropdownMenuItem>
                  <DropdownMenuItem>
                    Export every quest and folio as a CSV archive
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Group>

        <Group title="Collapsible">
          <Collapsible className="w-80">
            <CollapsibleTrigger chevron data-testid="primitives-collapsible">
              Try the demo
            </CollapsibleTrigger>
            <CollapsiblePanel data-testid="primitives-collapsible-panel">
              <div className="text-muted-foreground grid gap-2 pt-3 text-sm">
                <p>Sign in as one of the demo accounts, no password needed.</p>
                <div className="flex gap-2">
                  <Button variant="outlined" size="sm">
                    Viewer
                  </Button>
                  <Button variant="outlined" size="sm">
                    Admin
                  </Button>
                </div>
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </Group>
      </div>
    )}
  </Showcase>
);

export default Primitives;
