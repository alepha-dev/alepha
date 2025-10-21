import type { NotificationData } from "@mantine/notifications";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCheck,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";

export interface ToastServiceOptions {
  default?: Partial<NotificationData>;
}

export class ToastService {
  protected readonly raw = notifications;

  public readonly options: ToastServiceOptions = {
    default: {
      autoClose: 5000,
      withCloseButton: true,
      position: "top-center",
    },
  };

  public show(options: NotificationData) {
    notifications.show({
      ...this.options.default,
      ...options,
    });
  }

  public info(options: Partial<NotificationData>) {
    this.show({
      color: "blue",
      icon: <IconInfoCircle size={20} />,
      title: "Info",
      message: "Information notification",
      ...options,
    });
  }

  public success(options: Partial<NotificationData>) {
    this.show({
      color: "green",
      icon: <IconCheck size={16} />,
      title: "Success",
      message: "Operation completed successfully",
      ...options,
    });
  }

  public warning(options: Partial<NotificationData>) {
    this.show({
      color: "yellow",
      icon: <IconAlertTriangle size={20} />,
      title: "Warning",
      message: "Please review this warning",
      ...options,
    });
  }

  public danger(options: Partial<NotificationData>) {
    this.show({
      color: "red",
      icon: <IconX size={20} />,
      title: "Error",
      message: "An error occurred",
      ...options,
    });
  }
}
