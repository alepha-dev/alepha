import { $, glob } from "zx";

await $`rm -rf assets/swagger-ui`;
await $`mkdir -p assets/swagger-ui`;
await $`cp -r ../../node_modules/swagger-ui-dist/* ./assets/swagger-ui`;

const filesToRemove = [
	"NOTICE",
	"package.json",
	"LICENSE",
	"index.js",
	"swagger-initializer.js",
	"absolute-path.js",
	"README.md",
	"swagger-ui-es-bundle.js",
	"swagger-ui-es-bundle-core.js",
].map((item) => `assets/swagger-ui/${item}`);

$`rm -f ${filesToRemove}`;
$`rm -f ${await glob("assets/swagger-ui/*.map")}`;
