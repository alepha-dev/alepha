import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/entities/*.ts",
	out: "./drizzle",
	dialect: "postgresql",
});
