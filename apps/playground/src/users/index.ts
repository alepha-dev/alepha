import { $module } from "@alepha/core";
import Api from "./Api.ts";

const UserModule = $module({
	name: "app.users",
	services: [Api],
});

export default UserModule;
