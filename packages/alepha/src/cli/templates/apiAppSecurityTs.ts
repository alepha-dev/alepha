export const apiAppSecurityTs = () => {
  return `
import { $realm } from "alepha/api/users";

export class AppSecurity {
  users = $realm({
    // configure your realm here
  });
}
`.trim();
};
