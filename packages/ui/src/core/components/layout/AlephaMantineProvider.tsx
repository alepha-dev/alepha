import { NestedView, useEvents } from "@alepha/react";
import type {
  ColorSchemeScriptProps,
  MantineProviderProps,
} from "@mantine/core";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import { ModalsProvider, type ModalsProviderProps } from "@mantine/modals";
import { Notifications, type NotificationsProps } from "@mantine/notifications";
import type { NavigationProgressProps } from "@mantine/nprogress";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import type { ReactNode } from "react";
import { useToast } from "../../hooks/useToast.ts";
import Omnibar, { type OmnibarProps } from "./Omnibar.tsx";

export interface AlephaMantineProviderProps {
  children?: ReactNode;
  mantine?: MantineProviderProps;
  colorSchemeScript?: ColorSchemeScriptProps;
  navigationProgress?: NavigationProgressProps;
  notifications?: NotificationsProps;
  modals?: ModalsProviderProps;
  omnibar?: OmnibarProps;
}

const AlephaMantineProvider = (props: AlephaMantineProviderProps) => {
  const toast = useToast();

  useEvents(
    {
      "react:transition:begin": () => {
        nprogress.start();
      },
      "react:transition:end": () => {
        nprogress.complete();
      },
      "react:action:error": () => {
        toast.danger("An error occurred while processing your action.");
      },
    },
    [],
  );

  return (
    <>
      <ColorSchemeScript
        defaultColorScheme={props.mantine?.defaultColorScheme}
        {...props.colorSchemeScript}
      />
      <MantineProvider
        {...props.mantine}
        theme={{
          primaryColor: "gray",
          primaryShade: {
            light: 9,
            dark: 8,
          },
          cursorType: "pointer",
          ...props.mantine?.theme,
        }}
      >
        <Notifications {...props.notifications} />
        <NavigationProgress {...props.navigationProgress} />
        <ModalsProvider {...props.modals}>
          <Omnibar {...props.omnibar} />
          {props.children ?? <NestedView />}
        </ModalsProvider>
      </MantineProvider>
    </>
  );
};

export default AlephaMantineProvider;
