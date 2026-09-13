/**
 * The primitives every Alepha interface is built from.
 *
 * Buttons, inputs, cards, dialogs, sheets, menus, tooltips, the sidebar and the
 * rest of the Base UI + Tailwind primitives, each file exporting its whole
 * family. Beside them, the small pieces every surface reaches for: `cn` for
 * class merging, `useToast` with its `Toaster`, `useDialog` with its
 * `DialogProvider`, `useIsMobile`, `TimeAgo`, `UserAvatar`, `BrandIcon`,
 * `FileImage`, `PaneRail` and `FilterSlot`.
 *
 * Imports nothing from another `@alepha/ui` module, so
 * `import { Button } from "@alepha/ui"` never pulls in a form, a table or a
 * shell. Load the stylesheet once, at the app's entry: `@alepha/ui/styles.css`.
 *
 * @module alepha.ui
 */

export { Alert, AlertAction, AlertDescription, AlertTitle } from "./Alert.tsx";
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./AlertDialog.tsx";
export {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "./Avatar.tsx";
export { Badge, type BadgeTone, badgeVariants } from "./Badge.tsx";
export { BrandIcon, type BrandIconProps } from "./BrandIcon.tsx";
export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./Breadcrumb.tsx";
export { Button, buttonVariants } from "./Button.tsx";
export {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  buttonGroupVariants,
} from "./ButtonGroup.tsx";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card.tsx";
export { Checkbox } from "./Checkbox.tsx";
export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
} from "./Combobox.tsx";
export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ContextMenu.tsx";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./Dialog.tsx";
export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerSwipeHandle,
  DrawerTitle,
  DrawerTrigger,
} from "./Drawer.tsx";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./DropdownMenu.tsx";
export {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./Empty.tsx";
export { FileImage, type FileImageProps } from "./FileImage.tsx";
export { FilterSlot, type FilterSlotProps } from "./FilterSlot.tsx";
export { HoverCard, HoverCardContent, HoverCardTrigger } from "./HoverCard.tsx";
export { Input } from "./Input.tsx";
export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./InputGroup.tsx";
export { Kbd, KbdGroup } from "./Kbd.tsx";
export { Label } from "./Label.tsx";
export {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarPortal,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "./Menubar.tsx";
export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./Pagination.tsx";
export { PaneRail, type PaneRailProps } from "./PaneRail.tsx";
export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./Popover.tsx";
export {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "./Progress.tsx";
export {
  Segmented,
  type SegmentedOption,
  type SegmentedProps,
} from "./Segmented.tsx";
export { Separator } from "./Separator.tsx";
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./Sheet.tsx";
export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./Sidebar.tsx";
export { Skeleton } from "./Skeleton.tsx";
export { Slider } from "./Slider.tsx";
export { Spinner } from "./Spinner.tsx";
export { Switch } from "./Switch.tsx";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./Table.tsx";
export {
  Tabs,
  TabsContent,
  TabsList,
  tabsListVariants,
  TabsTrigger,
} from "./Tabs.tsx";
export { Textarea } from "./Textarea.tsx";
export { default as TimeAgo, type TimeAgoProps } from "./TimeAgo.tsx";
export { Toaster } from "./Toaster.tsx";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./Tooltip.tsx";
export {
  type AlertOptions,
  type ConfirmOptions,
  DialogProvider,
  type PromptOptions,
  useDialog,
  useHasDialogProvider,
} from "./useDialog.tsx";
export { useIsMobile } from "./useIsMobile.ts";
export { UserAvatar, type UserAvatarProps } from "./UserAvatar.tsx";
export {
  type Toast,
  type ToastIntent,
  type ToastOptions,
  useToast,
} from "./useToast.tsx";
export { cn, formatBytes } from "./utils.ts";
