import { $userRealm } from "alepha/api/users";

export class ApiSecurity {
  realm = $userRealm();
}
