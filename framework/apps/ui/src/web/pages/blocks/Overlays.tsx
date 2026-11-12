import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Input,
  Label,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@alepha/ui";
import { Link } from "alepha/react/router";

import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * The overlays the kit composes, each with something to focus inside it: a
 * sheet, a drawer, a dialog opened from inside a sheet (two layers), and a
 * link to a page that opens as an overlay route over this one. The keyboard
 * spec (`e2e/keyboard.spec.ts`) drives them with real keys, and the
 * accessibility scan visits this page like any other.
 */
const Overlays = () => (
  <Showcase
    id="blocks/Overlays"
    title="Overlays"
    description="Sheet, drawer, stacked layers and an overlay route."
    center
  >
    {() => (
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Sheet>
          <SheetTrigger render={<Button variant="outlined" />}>
            Open sheet
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>Narrow the list down.</SheetDescription>
            </SheetHeader>
            <div className="grid gap-2 px-4">
              <Label htmlFor="overlays-sheet-name">Name</Label>
              <Input id="overlays-sheet-name" />
              <Dialog>
                <DialogTrigger render={<Button variant="outlined" />}>
                  Open dialog
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Save the filter?</DialogTitle>
                    <DialogDescription>
                      A saved filter shows in the sidebar.
                    </DialogDescription>
                  </DialogHeader>
                  <Label htmlFor="overlays-dialog-name">Filter name</Label>
                  <Input id="overlays-dialog-name" />
                  <DialogFooter>
                    <DialogClose render={<Button variant="outlined" />}>
                      Cancel
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <SheetFooter>
              <SheetClose render={<Button variant="outlined" />}>
                Done
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        <Drawer>
          <DrawerTrigger render={<Button variant="outlined" />}>
            Open drawer
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Details</DrawerTitle>
              <DrawerDescription>More about this row.</DrawerDescription>
            </DrawerHeader>
            <div className="grid gap-2 px-4">
              <Label htmlFor="overlays-drawer-note">Note</Label>
              <Input id="overlays-drawer-note" />
            </div>
            <DrawerFooter>
              <DrawerClose render={<Button variant="outlined" />}>
                Close
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        <Link
          href="/blocks/overlays/panel"
          className="text-foreground text-sm underline underline-offset-4"
        >
          Open the panel route
        </Link>
      </div>
    )}
  </Showcase>
);

export default Overlays;
