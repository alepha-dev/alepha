import { NestedView, useEvents } from "@alepha/react";
import { FormValidationError } from "@alepha/react/form";
import {
  ColorSchemeScript,
  type ColorSchemeScriptProps,
  type MantineColorShade,
  MantineProvider,
  type MantineProviderProps,
} from "@mantine/core";
import { ModalsProvider, type ModalsProviderProps } from "@mantine/modals";
import { Notifications, type NotificationsProps } from "@mantine/notifications";
import type { NavigationProgressProps } from "@mantine/nprogress";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import type { ReactNode } from "react";
import { useTheme } from "../../hooks/useTheme.ts";
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
  const [theme] = useTheme();

  useEvents(
    {
      "react:transition:begin": () => {
        nprogress.start();
      },
      "react:transition:end": () => {
        nprogress.complete();
      },
      "react:action:error": ({ error }) => {
        if (error instanceof FormValidationError) {
          // Validation errors are handled by the form component
          return;
        }

        toast.danger({
          title: error.name || "Error",
          message:
            error.message ?? "An error occurred while processing your action.",
        });
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
          primaryColor: theme.primaryColor ?? "blue",
          primaryShade:
            (theme.primaryShade as MantineColorShade | undefined) ?? 6,
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
