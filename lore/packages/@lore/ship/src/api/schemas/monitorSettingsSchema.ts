import { monitors } from "../entities/monitors.ts";
export const monitorSettingsSchema = monitors.insertSchema.pick({
  name: true,
  kind: true,
  target: true,
  intervalSecs: true,
  timeoutSecs: true,
  confirmations: true,
  expect: true,
  notifications: true,
});
