import {
  Button,
  Input,
  Label,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@alepha/ui";
import { useOverlay } from "alepha/react/router";

/**
 * `/blocks/overlays/panel` as an overlay: a sheet over `/blocks/overlays`.
 * Closing it, by Escape or by its button, goes back through history.
 */
const OverlayPanelSheet = () => {
  const { close } = useOverlay();
  return (
    <Sheet
      defaultOpen
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Panel</SheetTitle>
          <SheetDescription>An overlay route, as a sheet.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-2 px-4">
          <Label htmlFor="overlay-panel-name">Name</Label>
          <Input id="overlay-panel-name" />
        </div>
        <SheetFooter>
          <SheetClose render={<Button variant="outlined" />}>Close</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default OverlayPanelSheet;
