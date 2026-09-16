import {
  Button,
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
 */
const Primitives = () => (
  <Showcase
    id="blocks/Primitives"
    title="Primitives"
    description="A tooltip and a dropdown menu, as the kit lays them out."
    center
  >
    {() => (
      <div className="grid gap-8">
        <Group title="Tooltip">
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="outline" data-testid="primitives-tooltip">
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
                    variant="outline"
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
      </div>
    )}
  </Showcase>
);

export default Primitives;
