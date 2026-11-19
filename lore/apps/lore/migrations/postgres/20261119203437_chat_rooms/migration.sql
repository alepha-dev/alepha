CREATE TABLE "chat_room_members" (
	"id" uuid PRIMARY KEY,
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_message_id" uuid,
	"notify_level" text DEFAULT 'mentions' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_rooms" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_room_members_room_id_user_id_idx" ON "chat_room_members" ("room_id","user_id");--> statement-breakpoint
CREATE INDEX "chat_room_members_user_id_idx" ON "chat_room_members" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_rooms_project_id_name_idx" ON "chat_rooms" ("project_id","name");--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_room_id_chat_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_project_id_projects_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;