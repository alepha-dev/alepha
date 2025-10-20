import { NestedView, useRouterEvents } from "@alepha/react";
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

export interface AlephaMantineProviderProps {
  children?: ReactNode;
  mantine?: MantineProviderProps;
  colorSchemeScript?: ColorSchemeScriptProps;
  navigationProgress?: NavigationProgressProps;
  notifications?: NotificationsProps;
  modals?: ModalsProviderProps;
}

const AlephaMantineProvider = (props: AlephaMantineProviderProps) => {
  useRouterEvents({
    onBegin: () => {
      nprogress.start();
    },
    onEnd: () => {
      nprogress.complete();
    },
  });

  return (
    <>
      <ColorSchemeScript
        defaultColorScheme={props.mantine?.defaultColorScheme}
        {...props.colorSchemeScript}
      />
      <MantineProvider {...props.mantine}>
        <Notifications {...props.notifications} />
        <NavigationProgress {...props.navigationProgress} />
        <ModalsProvider {...props.modals}>
          {props.children ?? <NestedView />}
        </ModalsProvider>
      </MantineProvider>
    </>
  );
};

export default AlephaMantineProvider;
