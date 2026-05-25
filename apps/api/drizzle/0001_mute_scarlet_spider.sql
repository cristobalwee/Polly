CREATE TABLE "market_categories_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kalshi_category" text NOT NULL,
	"kalshi_subcategory" text,
	"unified_category" text NOT NULL,
	"unified_subcategory" text
);
--> statement-breakpoint
CREATE TABLE "market_price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"yes_mid_cents" integer NOT NULL,
	"volume_cents" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"ticker" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"category" text DEFAULT 'Other' NOT NULL,
	"subcategory" text,
	"yes_sub_title" text,
	"no_sub_title" text,
	"status" text NOT NULL,
	"resolution_date" timestamp with time zone,
	"yes_bid" integer,
	"yes_ask" integer,
	"no_bid" integer,
	"no_ask" integer,
	"volume_24h_cents" bigint DEFAULT 0 NOT NULL,
	"total_volume_cents" bigint DEFAULT 0 NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_price_history" ADD CONSTRAINT "market_price_history_ticker_markets_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."markets"("ticker") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_price_history_ticker_ts_idx" ON "market_price_history" USING btree ("ticker","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "market_price_history_ticker_ts_unique" ON "market_price_history" USING btree ("ticker","timestamp");