CREATE TYPE "audits_severity_enum" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "commerce_checkout_sessions_status_enum" AS ENUM('open', 'paying', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "commerce_order_refunds_status_enum" AS ENUM('pending', 'done');--> statement-breakpoint
CREATE TYPE "commerce_order_returns_status_enum" AS ENUM('requested', 'received', 'refunded', 'refused');--> statement-breakpoint
CREATE TYPE "commerce_orders_status_enum" AS ENUM('pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "commerce_promotions_kind_enum" AS ENUM('percent', 'amount', 'freeShipping');--> statement-breakpoint
CREATE TYPE "commerce_resource_reservations_status_enum" AS ENUM('held', 'consumed', 'released');--> statement-breakpoint
CREATE TYPE "commerce_stock_movements_reason_enum" AS ENUM('intake', 'sale', 'return', 'adjustment');--> statement-breakpoint
CREATE TYPE "commerce_stock_reservations_status_enum" AS ENUM('held', 'consumed', 'released');--> statement-breakpoint
CREATE TYPE "job_executions_status_enum" AS ENUM('pending', 'running', 'scheduled', 'ok', 'error', 'cancelled');--> statement-breakpoint
CREATE TYPE "notification_deliveries_skip_reason_enum" AS ENUM('suppressed', 'declined', 'unavailable');--> statement-breakpoint
CREATE TYPE "notification_deliveries_status_enum" AS ENUM('sent', 'delivered', 'deferred', 'bounced', 'complained', 'failed', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "notification_suppressions_reason_enum" AS ENUM('unsubscribed', 'bounced', 'complained');--> statement-breakpoint
CREATE TYPE "payment_intents_status_enum" AS ENUM('created', 'processing', 'authorized', 'captured', 'partially_refunded', 'voided', 'failed', 'cancelled', 'refunded', 'expired');--> statement-breakpoint
CREATE TYPE "refunds_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "verification_type_enum" AS ENUM('code', 'link');--> statement-breakpoint
CREATE TYPE "webhook_deliveries_status_enum" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "webhook_endpoints_disabled_reason_enum" AS ENUM('gone', 'failing', 'secret');--> statement-breakpoint
CREATE TYPE "webhook_endpoints_status_enum" AS ENUM('active', 'paused', 'disabled');--> statement-breakpoint
CREATE TABLE "alepha_sequences" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'default' NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope_type" text,
	"scope_id" text,
	"type" text NOT NULL,
	"action" text NOT NULL,
	"severity" "audits_severity_enum" DEFAULT 'info'::"audits_severity_enum" NOT NULL,
	"user_id" uuid,
	"user_realm" text,
	"user_email" text,
	"resource_type" text,
	"resource_id" text,
	"description" text,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"session_id" uuid,
	"request_id" text,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"event_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cache_entries" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"container" text NOT NULL,
	"cache_key" text NOT NULL,
	"value" text,
	"count" integer,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "commerce_addresses" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"locality" text NOT NULL,
	"region" text,
	"postal_code" text NOT NULL,
	"country" text NOT NULL,
	"phone" text,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_cart_items" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" integer NOT NULL,
	"line_config" jsonb,
	"line_key" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_carts" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid,
	"expires_at" text NOT NULL,
	"promotion_code" text,
	"currency" text
);
--> statement-breakpoint
CREATE TABLE "commerce_categories" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_checkout_sessions" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cart_id" uuid NOT NULL,
	"user_id" uuid,
	"status" "commerce_checkout_sessions_status_enum" DEFAULT 'open'::"commerce_checkout_sessions_status_enum" NOT NULL,
	"email" text,
	"recovery_consent_at" text,
	"recovery_token" text,
	"vat_number" text,
	"shipping_address" jsonb,
	"shipping_method" text,
	"subtotal" integer DEFAULT 0 NOT NULL,
	"discount_total" integer DEFAULT 0 NOT NULL,
	"shipping_total" integer DEFAULT 0 NOT NULL,
	"tax_total" integer DEFAULT 0 NOT NULL,
	"grand_total" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"order_id" uuid,
	"payment_intent_id" text
);
--> statement-breakpoint
CREATE TABLE "commerce_downloads" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"max_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_invoices" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text NOT NULL,
	"year" integer NOT NULL,
	"order_id" uuid NOT NULL,
	"credits_invoice_id" uuid,
	"note" text,
	"issued_at" text NOT NULL,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"vat_buckets" jsonb NOT NULL,
	"base_total" integer NOT NULL,
	"vat_total" integer NOT NULL,
	"grand_total" integer NOT NULL,
	"currency" text NOT NULL,
	"books_vat" jsonb
);
--> statement-breakpoint
CREATE TABLE "commerce_order_items" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"variant_label" text,
	"unit_price" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"rate_bps" integer,
	"quantity" integer NOT NULL,
	"refunded_quantity" integer DEFAULT 0 NOT NULL,
	"cancelled_quantity" integer DEFAULT 0 NOT NULL,
	"config" jsonb,
	"line_config" jsonb
);
--> statement-breakpoint
CREATE TABLE "commerce_order_refunds" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reason" text,
	"lines" jsonb DEFAULT '[]' NOT NULL,
	"status" "commerce_order_refunds_status_enum" DEFAULT 'pending'::"commerce_order_refunds_status_enum" NOT NULL,
	"credit_note_id" uuid
);
--> statement-breakpoint
CREATE TABLE "commerce_order_returns" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "commerce_order_returns_status_enum" DEFAULT 'requested'::"commerce_order_returns_status_enum" NOT NULL,
	"lines" jsonb NOT NULL,
	"reason" text,
	"note" text,
	"received_at" text,
	"refund_id" uuid
);
--> statement-breakpoint
CREATE TABLE "commerce_orders" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" text,
	"user_id" uuid,
	"status" "commerce_orders_status_enum" NOT NULL,
	"total" integer NOT NULL,
	"discount_total" integer DEFAULT 0 NOT NULL,
	"promotion_code" text,
	"shipping_total" integer DEFAULT 0 NOT NULL,
	"tax_total" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"refunded_total" integer DEFAULT 0 NOT NULL,
	"tax_country" text,
	"shipping_rate_bps" integer,
	"vat_number" text,
	"payment_intent_id" text,
	"shipping_method" text,
	"tracking_number" text,
	"tracking_url" text,
	"shipped_at" text,
	"delivered_at" text,
	"shipping_address" jsonb,
	"notes" text,
	"stray_captures" jsonb
);
--> statement-breakpoint
CREATE TABLE "commerce_product_prices" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_key" text DEFAULT '' NOT NULL,
	"currency" text NOT NULL,
	"price" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_product_variants" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"options" jsonb NOT NULL,
	"price" integer,
	"compare_at_price" integer,
	"image" text,
	"weight_grams" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_products" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text DEFAULT 'good' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"compare_at_price" integer,
	"meta_title" text,
	"meta_description" text,
	"weight_grams" integer,
	"length_mm" integer,
	"width_mm" integer,
	"height_mm" integer,
	"category_id" uuid,
	"images" text[] DEFAULT '{}'::text[] NOT NULL,
	"vat_rate_bps" integer,
	"option_groups" jsonb DEFAULT '[]' NOT NULL,
	"config" jsonb,
	"attributes" jsonb,
	"tracks_stock" boolean DEFAULT true NOT NULL,
	"published" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_promotion_redemptions" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text
);
--> statement-breakpoint
CREATE TABLE "commerce_promotions" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"kind" "commerce_promotions_kind_enum" NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"min_subtotal" integer,
	"currency" text,
	"starts_at" text,
	"ends_at" text,
	"usage_limit" integer,
	"usage_per_customer" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_recovery_opt_outs" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_resource_reservations" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resource_id" text NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"quantity" integer NOT NULL,
	"order_id" uuid,
	"order_item_id" uuid,
	"label" text,
	"status" "commerce_resource_reservations_status_enum" DEFAULT 'held'::"commerce_resource_reservations_status_enum" NOT NULL,
	"expires_at" text
);
--> statement-breakpoint
CREATE TABLE "commerce_shipping_rates" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"zone_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"currency" text,
	"free_above" integer,
	"min_weight_grams" integer,
	"max_weight_grams" integer,
	"min_days" integer,
	"max_days" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_shipping_zones" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"countries" text[] NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_stock_movements" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"delta" integer NOT NULL,
	"reason" "commerce_stock_movements_reason_enum" NOT NULL,
	"order_id" uuid,
	"order_item_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "commerce_stock_reservations" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" integer NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "commerce_stock_reservations_status_enum" DEFAULT 'held'::"commerce_stock_reservations_status_enum" NOT NULL,
	"expires_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blob_id" text NOT NULL,
	"creator" uuid,
	"creator_realm" text,
	"creator_name" text,
	"bucket" text NOT NULL,
	"expiration_date" timestamp with time zone,
	"name" text NOT NULL,
	"original_name" text,
	"size" double precision NOT NULL,
	"mime_type" text NOT NULL,
	"tags" text[],
	"checksum" text
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"password" text,
	"provider" text NOT NULL,
	"provider_user_id" text,
	"provider_data" jsonb
);
--> statement-breakpoint
CREATE TABLE "job_cron_claims" (
	"id" text PRIMARY KEY,
	"job_name" text NOT NULL,
	"instant" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_executions" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_name" text NOT NULL,
	"key" text,
	"status" "job_executions_status_enum" DEFAULT 'pending'::"job_executions_status_enum" NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"redispatch_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text,
	"logs" jsonb,
	"steps" jsonb,
	"triggered_by" text,
	"triggered_by_name" text,
	"cancelled_by" text,
	"cancelled_by_name" text
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"execution_id" text NOT NULL,
	"message_id" text,
	"provider" text NOT NULL,
	"channel" text NOT NULL,
	"contact" text NOT NULL,
	"template" text NOT NULL,
	"category" text,
	"critical" boolean DEFAULT false NOT NULL,
	"status" "notification_deliveries_status_enum" NOT NULL,
	"skip_reason" "notification_deliveries_skip_reason_enum",
	"subject" text,
	"body" text,
	"last_event_at" timestamp with time zone,
	"smtp_status_code" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "notification_inbox" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text,
	"scope_label" text,
	"template" text NOT NULL,
	"category" text,
	"title" text NOT NULL,
	"body" text,
	"href" text NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_suppressions" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contact" text NOT NULL,
	"channel" text NOT NULL,
	"reason" "notification_suppressions_reason_enum" NOT NULL,
	"category" text DEFAULT '*' NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parameters" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"content" jsonb NOT NULL,
	"schema_hash" text NOT NULL,
	"activation_date" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	"change_description" text,
	"tags" text[],
	"creator_id" uuid,
	"creator_name" text,
	"previous_content" jsonb,
	"migration_log" text
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "payment_intents_status_enum" NOT NULL,
	"provider_ref" text,
	"provider_account" text,
	"save_card" boolean,
	"provider_raw" jsonb,
	"metadata" jsonb,
	"payment_method_id" uuid,
	"user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"brand" text,
	"last4" text,
	"exp_month" integer,
	"exp_year" integer,
	"is_default" boolean NOT NULL,
	"provider_ref" text NOT NULL,
	"provider_account" text
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"intent_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "refunds_status_enum" NOT NULL,
	"reason" text,
	"provider_ref" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refresh_token" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text,
	"scopes" text[],
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"ip" text,
	"country" text,
	"user_agent" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"realm" text DEFAULT 'users' NOT NULL,
	"username" text,
	"email" text,
	"phone_number" text,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_name" text,
	"last_name" text,
	"picture" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verification_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"type" "verification_type_enum" NOT NULL,
	"target" text NOT NULL,
	"purpose" text DEFAULT 'default' NOT NULL,
	"code" text NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_deliveries_status_enum" DEFAULT 'pending'::"webhook_deliveries_status_enum" NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_excerpt" text,
	"duration_ms" integer,
	"delivered_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"secret" text NOT NULL,
	"previous_secret" text,
	"secret_prefix" text NOT NULL,
	"previous_secret_expires_at" timestamp with time zone,
	"status" "webhook_endpoints_status_enum" DEFAULT 'active'::"webhook_endpoints_status_enum" NOT NULL,
	"disabled_reason" "webhook_endpoints_disabled_reason_enum",
	"scope" text,
	"created_by" uuid,
	"failing_since" timestamp with time zone,
	"last_delivery_at" timestamp with time zone,
	"last_success_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "alepha_sequences_name_scope_idx" ON "alepha_sequences" ("name","scope");--> statement-breakpoint
CREATE INDEX "audits_scope_type_scope_id_created_at_idx" ON "audits" ("scope_type","scope_id","created_at") WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audits_scope_type_scope_id_user_id_created_at_idx" ON "audits" ("scope_type","scope_id","user_id","created_at") WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audits_scope_type_scope_id_type_action_created_at_idx" ON "audits" ("scope_type","scope_id","type","action","created_at") WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audits_scope_type_scope_id_action_created_at_idx" ON "audits" ("scope_type","scope_id","action","created_at") WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audits_created_at_idx" ON "audits" ("created_at");--> statement-breakpoint
CREATE INDEX "audits_type_action_created_at_idx" ON "audits" ("type","action","created_at");--> statement-breakpoint
CREATE INDEX "audits_user_id_created_at_idx" ON "audits" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audits_user_realm_created_at_idx" ON "audits" ("user_realm","created_at");--> statement-breakpoint
CREATE INDEX "audits_resource_type_resource_id_created_at_idx" ON "audits" ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cache_entries_container_cache_key_idx" ON "cache_entries" ("container","cache_key");--> statement-breakpoint
CREATE INDEX "cache_entries_expires_at_idx" ON "cache_entries" ("expires_at");--> statement-breakpoint
CREATE INDEX "commerce_addresses_user_id_idx" ON "commerce_addresses" ("user_id");--> statement-breakpoint
CREATE INDEX "commerce_addresses_country_idx" ON "commerce_addresses" ("country");--> statement-breakpoint
CREATE INDEX "commerce_cart_items_cart_id_idx" ON "commerce_cart_items" ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_cart_items_cart_id_product_id_line_key_idx" ON "commerce_cart_items" ("cart_id","product_id","line_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_carts_token_idx" ON "commerce_carts" ("token");--> statement-breakpoint
CREATE INDEX "commerce_carts_user_id_idx" ON "commerce_carts" ("user_id");--> statement-breakpoint
CREATE INDEX "commerce_carts_expires_at_idx" ON "commerce_carts" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_categories_slug_idx" ON "commerce_categories" ("slug");--> statement-breakpoint
CREATE INDEX "commerce_categories_parent_id_idx" ON "commerce_categories" ("parent_id");--> statement-breakpoint
CREATE INDEX "commerce_checkout_sessions_cart_id_idx" ON "commerce_checkout_sessions" ("cart_id");--> statement-breakpoint
CREATE INDEX "commerce_checkout_sessions_status_idx" ON "commerce_checkout_sessions" ("status");--> statement-breakpoint
CREATE INDEX "commerce_checkout_sessions_order_id_idx" ON "commerce_checkout_sessions" ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_downloads_token_idx" ON "commerce_downloads" ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_downloads_order_item_id_idx" ON "commerce_downloads" ("order_item_id");--> statement-breakpoint
CREATE INDEX "commerce_downloads_order_id_idx" ON "commerce_downloads" ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_invoices_number_idx" ON "commerce_invoices" ("number");--> statement-breakpoint
CREATE INDEX "commerce_invoices_order_id_idx" ON "commerce_invoices" ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_invoices_year_idx" ON "commerce_invoices" ("year");--> statement-breakpoint
CREATE INDEX "commerce_order_items_order_id_idx" ON "commerce_order_items" ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_order_items_product_id_idx" ON "commerce_order_items" ("product_id");--> statement-breakpoint
CREATE INDEX "commerce_order_refunds_order_id_idx" ON "commerce_order_refunds" ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_order_refunds_status_idx" ON "commerce_order_refunds" ("status");--> statement-breakpoint
CREATE INDEX "commerce_order_returns_order_id_idx" ON "commerce_order_returns" ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_order_returns_status_idx" ON "commerce_order_returns" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_orders_number_idx" ON "commerce_orders" ("number");--> statement-breakpoint
CREATE INDEX "commerce_orders_status_idx" ON "commerce_orders" ("status");--> statement-breakpoint
CREATE INDEX "commerce_orders_user_id_idx" ON "commerce_orders" ("user_id");--> statement-breakpoint
CREATE INDEX "commerce_orders_created_at_idx" ON "commerce_orders" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_product_prices_product_id_variant_key_currency_idx" ON "commerce_product_prices" ("product_id","variant_key","currency");--> statement-breakpoint
CREATE INDEX "commerce_product_prices_currency_idx" ON "commerce_product_prices" ("currency");--> statement-breakpoint
CREATE INDEX "commerce_product_prices_variant_key_idx" ON "commerce_product_prices" ("variant_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_product_variants_sku_idx" ON "commerce_product_variants" ("sku");--> statement-breakpoint
CREATE INDEX "commerce_product_variants_product_id_idx" ON "commerce_product_variants" ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_products_slug_idx" ON "commerce_products" ("slug");--> statement-breakpoint
CREATE INDEX "commerce_products_kind_idx" ON "commerce_products" ("kind");--> statement-breakpoint
CREATE INDEX "commerce_products_published_idx" ON "commerce_products" ("published");--> statement-breakpoint
CREATE INDEX "commerce_products_category_id_idx" ON "commerce_products" ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_promotion_redemptions_promotion_id_order_id_idx" ON "commerce_promotion_redemptions" ("promotion_id","order_id");--> statement-breakpoint
CREATE INDEX "commerce_promotion_redemptions_order_id_idx" ON "commerce_promotion_redemptions" ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_promotion_redemptions_user_id_idx" ON "commerce_promotion_redemptions" ("user_id");--> statement-breakpoint
CREATE INDEX "commerce_promotion_redemptions_email_idx" ON "commerce_promotion_redemptions" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_promotions_code_idx" ON "commerce_promotions" ("code");--> statement-breakpoint
CREATE INDEX "commerce_promotions_active_idx" ON "commerce_promotions" ("active");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_recovery_opt_outs_email_idx" ON "commerce_recovery_opt_outs" ("email");--> statement-breakpoint
CREATE INDEX "commerce_resource_reservations_resource_id_status_idx" ON "commerce_resource_reservations" ("resource_id","status");--> statement-breakpoint
CREATE INDEX "commerce_resource_reservations_order_id_idx" ON "commerce_resource_reservations" ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_resource_reservations_order_item_id_idx" ON "commerce_resource_reservations" ("order_item_id");--> statement-breakpoint
CREATE INDEX "commerce_resource_reservations_status_expires_at_idx" ON "commerce_resource_reservations" ("status","expires_at");--> statement-breakpoint
CREATE INDEX "commerce_shipping_rates_zone_id_idx" ON "commerce_shipping_rates" ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_shipping_rates_code_idx" ON "commerce_shipping_rates" ("code");--> statement-breakpoint
CREATE INDEX "commerce_shipping_zones_priority_idx" ON "commerce_shipping_zones" ("priority");--> statement-breakpoint
CREATE INDEX "commerce_stock_movements_product_id_idx" ON "commerce_stock_movements" ("product_id");--> statement-breakpoint
CREATE INDEX "commerce_stock_movements_variant_id_idx" ON "commerce_stock_movements" ("variant_id");--> statement-breakpoint
CREATE INDEX "commerce_stock_movements_order_id_idx" ON "commerce_stock_movements" ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_stock_reservations_product_id_status_idx" ON "commerce_stock_reservations" ("product_id","status");--> statement-breakpoint
CREATE INDEX "commerce_stock_reservations_variant_id_status_idx" ON "commerce_stock_reservations" ("variant_id","status");--> statement-breakpoint
CREATE INDEX "commerce_stock_reservations_order_id_idx" ON "commerce_stock_reservations" ("order_id");--> statement-breakpoint
CREATE INDEX "commerce_stock_reservations_status_expires_at_idx" ON "commerce_stock_reservations" ("status","expires_at");--> statement-breakpoint
CREATE INDEX "files_expiration_date_idx" ON "files" ("expiration_date");--> statement-breakpoint
CREATE INDEX "files_bucket_idx" ON "files" ("bucket");--> statement-breakpoint
CREATE INDEX "files_creator_idx" ON "files" ("creator");--> statement-breakpoint
CREATE INDEX "files_created_at_idx" ON "files" ("created_at");--> statement-breakpoint
CREATE INDEX "files_mime_type_idx" ON "files" ("mime_type");--> statement-breakpoint
CREATE INDEX "files_bucket_created_at_idx" ON "files" ("bucket","created_at");--> statement-breakpoint
CREATE INDEX "identities_user_id_idx" ON "identities" ("user_id");--> statement-breakpoint
CREATE INDEX "identities_provider_idx" ON "identities" ("provider");--> statement-breakpoint
CREATE INDEX "identities_user_id_provider_idx" ON "identities" ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_provider_provider_user_id_idx" ON "identities" ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "job_executions_status_scheduled_at_idx" ON "job_executions" ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_executions_status_updated_at_idx" ON "job_executions" ("status","updated_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_status_scheduled_at_idx" ON "job_executions" ("job_name","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_status_created_at_idx" ON "job_executions" ("job_name","status","created_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_started_at_idx" ON "job_executions" ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_executions_job_name_key_idx" ON "job_executions" ("job_name","key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_execution_id_idx" ON "notification_deliveries" ("execution_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_message_id_idx" ON "notification_deliveries" ("message_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_created_at_idx" ON "notification_deliveries" ("created_at");--> statement-breakpoint
CREATE INDEX "notification_inbox_user_id_read_at_created_at_idx" ON "notification_inbox" ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notification_inbox_user_id_scope_created_at_idx" ON "notification_inbox" ("user_id","scope","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_suppressions_channel_contact_reason_category_idx" ON "notification_suppressions" ("channel","contact","reason","category");--> statement-breakpoint
CREATE INDEX "notification_suppressions_channel_contact_idx" ON "notification_suppressions" ("channel","contact");--> statement-breakpoint
CREATE INDEX "parameters_name_activation_date_idx" ON "parameters" ("name","activation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "parameters_name_version_idx" ON "parameters" ("name","version");--> statement-breakpoint
CREATE INDEX "parameters_activation_date_idx" ON "parameters" ("activation_date");--> statement-breakpoint
CREATE INDEX "payment_intents_status_idx" ON "payment_intents" ("status");--> statement-breakpoint
CREATE INDEX "payment_intents_user_id_idx" ON "payment_intents" ("user_id");--> statement-breakpoint
CREATE INDEX "payment_intents_created_at_idx" ON "payment_intents" ("created_at");--> statement-breakpoint
CREATE INDEX "payment_methods_user_id_idx" ON "payment_methods" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_provider_account_provider_ref_idx" ON "payment_methods" ("provider_account","provider_ref");--> statement-breakpoint
CREATE INDEX "refunds_intent_id_idx" ON "refunds" ("intent_id");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_token_idx" ON "sessions" ("refresh_token");--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_username_ci_idx" ON "users" ("realm",LOWER("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_email_idx" ON "users" ("realm","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_realm_phone_number_idx" ON "users" ("realm","phone_number");--> statement-breakpoint
CREATE INDEX "verification_created_at_idx" ON "verification" ("created_at");--> statement-breakpoint
CREATE INDEX "verification_target_code_idx" ON "verification" ("target","code");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries" ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_event_type_created_at_idx" ON "webhook_deliveries" ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" ("status");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_status_idx" ON "webhook_endpoints" ("status");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_scope_idx" ON "webhook_endpoints" ("scope");--> statement-breakpoint
ALTER TABLE "commerce_cart_items" ADD CONSTRAINT "commerce_cart_items_cart_id_commerce_carts_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "commerce_carts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_order_id_commerce_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce_orders"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "commerce_product_prices" ADD CONSTRAINT "commerce_product_prices_product_id_commerce_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "commerce_products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "commerce_product_variants" ADD CONSTRAINT "commerce_product_variants_product_id_commerce_products_id_fkey" FOREIGN KEY ("product_id") REFERENCES "commerce_products"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "commerce_promotion_redemptions" ADD CONSTRAINT "commerce_promotion_redemptions_2XRJtE0MRUcV_fkey" FOREIGN KEY ("promotion_id") REFERENCES "commerce_promotions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "commerce_shipping_rates" ADD CONSTRAINT "commerce_shipping_rates_zone_id_commerce_shipping_zones_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "commerce_shipping_zones"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE;