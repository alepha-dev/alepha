CREATE TYPE "playground"."message_type_enum" AS ENUM('raw', 'binary');--> statement-breakpoint
CREATE TYPE "playground"."supports_type_enum" AS ENUM('raw', 'binary');--> statement-breakpoint
CREATE TABLE "playground"."message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"type" "playground"."message_type_enum" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playground"."organizations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "playground"."organizations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playground"."supports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "playground"."supports_type_enum" NOT NULL
);
