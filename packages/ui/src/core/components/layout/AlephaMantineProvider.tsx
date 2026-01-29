import {
  ColorSchemeScript,
  type ColorSchemeScriptProps,
  MantineProvider,
  type MantineProviderProps,
} from "@mantine/core";
import { ModalsProvider, type ModalsProviderProps } from "@mantine/modals";
import { Notifications, type NotificationsProps } from "@mantine/notifications";
import type { NavigationProgressProps } from "@mantine/nprogress";
import { NavigationProgress, nprogress } from "@mantine/nprogress";
import { TypeBoxError } from "alepha";
import { useEvents } from "alepha/react";
import { FormValidationError } from "alepha/react/form";
import { NestedView } from "alepha/react/router";
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
  omnibar?: OmnibarProps | false;
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
        if (
          error instanceof FormValidationError ||
          error instanceof TypeBoxError
        ) {
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

  const defaultColorScheme =
    props.mantine?.defaultColorScheme ?? theme.defaultColorScheme;

  return (
    <>
      <ColorSchemeScript
        defaultColorScheme={defaultColorScheme}
        {...props.colorSchemeScript}
      />
      <MantineProvider
        {...props.mantine}
        defaultColorScheme={defaultColorScheme}
        theme={{
          // Spread all theme properties from the selected theme
          ...theme,
          // User overrides take precedence
          ...props.mantine?.theme,
        }}
      >
        <Notifications {...props.notifications} />
        <NavigationProgress {...props.navigationProgress} />
        <ModalsProvider {...props.modals}>
          {props.omnibar !== false && <Omnibar {...props.omnibar} />}
          {props.children ?? <NestedView />}
        </ModalsProvider>
      </MantineProvider>
    </>
  );
};

export default AlephaMantineProvider;
