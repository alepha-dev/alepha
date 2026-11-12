import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { expectAccessible, renderWithAlepha } from "alepha/testing/react";
import { afterEach, describe, expect, it } from "vitest";

import { Alert, AlertDescription, AlertTitle } from "../Alert.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../AlertDialog.tsx";
import { Avatar, AvatarFallback } from "../Avatar.tsx";
import { Badge } from "../Badge.tsx";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../Breadcrumb.tsx";
import { Button } from "../Button.tsx";
import { ButtonGroup } from "../ButtonGroup.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../Card.tsx";
import { Checkbox } from "../Checkbox.tsx";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "../Collapsible.tsx";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "../Combobox.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ContextMenu.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../Dialog.tsx";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../Drawer.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../DropdownMenu.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../Empty.tsx";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../HoverCard.tsx";
import { Input } from "../Input.tsx";
import { Kbd } from "../Kbd.tsx";
import { Label } from "../Label.tsx";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "../Menubar.tsx";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "../Pagination.tsx";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../Popover.tsx";
import { Progress } from "../Progress.tsx";
import { Separator } from "../Separator.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../Sheet.tsx";
import { Skeleton } from "../Skeleton.tsx";
import { Slider } from "../Slider.tsx";
import { Spinner } from "../Spinner.tsx";
import { Switch } from "../Switch.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../Table.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../Tabs.tsx";
import { Textarea } from "../Textarea.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../Tooltip.tsx";

/**
 * One axe scan per primitive family of `@alepha/ui`, under jsdom (#Q3338).
 *
 * Structure only: names, roles, aria wiring, labels. Contrast and target size
 * are scanned on the showcase in Chromium. Every overlay is scanned open, on
 * `document.body`, since its popup is portalled outside the render container.
 */
describe("core primitives pass axe", () => {
  afterEach(() => {
    cleanup();
  });

  it("buttons, button groups, badges, kbd, avatar, spinner, skeleton, separator", async () => {
    render(
      <main>
        <Button>Save</Button>
        <Button size="icon" aria-label="Delete">
          x
        </Button>
        <ButtonGroup>
          <Button variant="outlined">Left</Button>
          <Button variant="outlined">Right</Button>
        </ButtonGroup>
        <Badge>New</Badge>
        <Kbd>K</Kbd>
        <Avatar>
          <AvatarFallback>AB</AvatarFallback>
        </Avatar>
        <Spinner />
        <Skeleton className="h-4 w-20" />
        <Separator />
      </main>,
    );
    await expectAccessible();
  });

  it("alert, card, empty", async () => {
    render(
      <main>
        <Alert>
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>Something happened.</AlertDescription>
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardDescription>Description</CardDescription>
          </CardHeader>
          <CardContent>Body</CardContent>
        </Card>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No results</EmptyTitle>
            <EmptyDescription>Try another search.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>,
    );
    await expectAccessible();
  });

  it("inputs, textarea, label, checkbox, switch, slider, progress", async () => {
    // In an Alepha context: the slider reads the page's CSP nonce.
    await renderWithAlepha(
      <main>
        <Label htmlFor="name">Name</Label>
        <Input id="name" />
        <Label htmlFor="bio">Bio</Label>
        <Textarea id="bio" />
        <Checkbox aria-label="Accept the terms" />
        <Switch aria-label="Notifications" />
        <Slider defaultValue={30} aria-label="Volume" />
        <Progress value={40} aria-label="Upload" />
      </main>,
    );
    await expectAccessible();
  });

  it("breadcrumb, pagination, table", async () => {
    render(
      <main>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Settings</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#" isActive>
                1
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
        <Table>
          <TableCaption>Invoices</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>INV-1</TableCell>
              <TableCell>12</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </main>,
    );
    await expectAccessible();
  });

  it("tabs and collapsible, open", async () => {
    render(
      <main>
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">Account</TabsTrigger>
            <TabsTrigger value="b">Password</TabsTrigger>
          </TabsList>
          <TabsContent value="a">Account settings</TabsContent>
          <TabsContent value="b">Password settings</TabsContent>
        </Tabs>
        <Collapsible defaultOpen>
          <CollapsibleTrigger chevron>More</CollapsibleTrigger>
          <CollapsiblePanel>Hidden content</CollapsiblePanel>
        </Collapsible>
      </main>,
    );
    await expectAccessible();
  });

  it("dialog, closed then open", async () => {
    render(
      <main>
        <Dialog>
          <DialogTrigger render={<Button />}>Open</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit profile</DialogTitle>
              <DialogDescription>Change your name.</DialogDescription>
            </DialogHeader>
            <Label htmlFor="dialog-name">Name</Label>
            <Input id="dialog-name" />
          </DialogContent>
        </Dialog>
      </main>,
    );
    await expectAccessible();
    cleanup();
    render(
      <main>
        <Dialog defaultOpen>
          <DialogTrigger render={<Button />}>Open</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit profile</DialogTitle>
              <DialogDescription>Change your name.</DialogDescription>
            </DialogHeader>
            <Label htmlFor="dialog-name">Name</Label>
            <Input id="dialog-name" />
          </DialogContent>
        </Dialog>
      </main>,
    );
    await screen.findByRole("dialog");
    await expectAccessible();
  });

  it("alert dialog, open", async () => {
    render(
      <main>
        <AlertDialog defaultOpen>
          <AlertDialogTrigger render={<Button />}>Delete</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete the project?</AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>,
    );
    await screen.findByRole("alertdialog");
    await expectAccessible();
  });

  it("sheet, open", async () => {
    render(
      <main>
        <Sheet defaultOpen>
          <SheetTrigger render={<Button />}>Open</SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>Narrow the list.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </main>,
    );
    await screen.findByRole("dialog");
    await expectAccessible();
  });

  it("drawer, open", async () => {
    render(
      <main>
        <Drawer defaultOpen>
          <DrawerTrigger render={<Button />}>Open</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Details</DrawerTitle>
              <DrawerDescription>More about this row.</DrawerDescription>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>
      </main>,
    );
    await screen.findByRole("dialog");
    await expectAccessible();
  });

  it("dropdown menu, open", async () => {
    render(
      <main>
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger render={<Button />}>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Rename</DropdownMenuItem>
            <DropdownMenuItem>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </main>,
    );
    await screen.findByRole("menu");
    await expectAccessible();
  });

  it("context menu, open", async () => {
    render(
      <main>
        <ContextMenu defaultOpen>
          <ContextMenuTrigger>Right-click here</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Copy</ContextMenuItem>
            <ContextMenuItem>Paste</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </main>,
    );
    await screen.findByRole("menu");
    await expectAccessible();
  });

  it("menubar, a menu open", async () => {
    render(
      <main>
        <Menubar>
          <MenubarMenu defaultOpen>
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>New</MenubarItem>
              <MenubarItem>Open</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </main>,
    );
    await screen.findByRole("menu");
    await expectAccessible();
  });

  it("popover, open", async () => {
    render(
      <main>
        <Popover defaultOpen>
          <PopoverTrigger render={<Button />}>Details</PopoverTrigger>
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>Dimensions</PopoverTitle>
              <PopoverDescription>Set the size.</PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      </main>,
    );
    await screen.findByRole("dialog");
    await expectAccessible();
  });

  it("hover card, open", async () => {
    render(
      <main>
        <HoverCard defaultOpen>
          <HoverCardTrigger href="/u/ada">@ada</HoverCardTrigger>
          <HoverCardContent>Ada, engineer.</HoverCardContent>
        </HoverCard>
      </main>,
    );
    await screen.findByText("Ada, engineer.");
    await expectAccessible();
  });

  it("tooltip, open", async () => {
    render(
      <main>
        <TooltipProvider>
          <Tooltip defaultOpen>
            <TooltipTrigger render={<Button />}>Hover</TooltipTrigger>
            <TooltipContent>Add to the library</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </main>,
    );
    await screen.findByText("Add to the library");
    await expectAccessible();
  });

  it("combobox, open", async () => {
    render(
      <main>
        <Combobox items={["Apple", "Banana"]} defaultOpen>
          <ComboboxInput aria-label="Fruit" />
          <ComboboxContent>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </main>,
    );
    await waitFor(() => {
      expect(document.querySelector("[role=listbox]")).not.toBeNull();
    });
    await expectAccessible();
  });
});
