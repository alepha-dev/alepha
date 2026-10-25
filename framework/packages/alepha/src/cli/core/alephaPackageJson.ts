import pkg from "alepha/package.json" with { type: "json" };

export const alephaPackageJson = pkg;
export const version = pkg.version as string;
