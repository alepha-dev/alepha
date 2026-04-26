import type { ComponentProps, ReactNode } from "react";

export const SidebarProvider: (props: {
  children?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) => any = () => null;
export const Sidebar: (props: {
  collapsible?: "icon" | "offcanvas" | "none";
  className?: string;
  children?: ReactNode;
}) => any = () => null;
export const SidebarHeader: (props: { children?: ReactNode }) => any = () =>
  null;
export const SidebarFooter: (props: { children?: ReactNode }) => any = () =>
  null;
export const SidebarContent: (props: { children?: ReactNode }) => any = () =>
  null;
export const SidebarGroup: (props: { children?: ReactNode }) => any = () =>
  null;
export const SidebarGroupLabel: (props: { children?: ReactNode }) => any = () =>
  null;
export const SidebarGroupContent: (props: { children?: ReactNode }) => any =
  () => null;
export const SidebarMenu: (props: { children?: ReactNode }) => any = () => null;
export const SidebarMenuItem: (props: { children?: ReactNode }) => any = () =>
  null;
export const SidebarMenuButton: (props: {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string;
  children?: ReactNode;
}) => any = () => null;
export const SidebarTrigger: (props: ComponentProps<"button">) => any = () =>
  null;
export const SidebarInset: (props: { children?: ReactNode }) => any = () =>
  null;
export const SidebarRail: (props: Record<string, never>) => any = () => null;
export const useSidebar: () => {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  isMobile: boolean;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
} = () => ({
  state: "expanded",
  open: true,
  setOpen: () => {},
  toggleSidebar: () => {},
  isMobile: false,
  openMobile: false,
  setOpenMobile: () => {},
});
