CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kalshi_order_id" text NOT NULL,
	"ticker" text NOT NULL,
	"side" text NOT NULL,
	"action" text NOT NULL,
	"count" integer NOT NULL,
	"remaining_count" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"ticker" text NOT NULL,
	"side" text NOT NULL,
	"count" integer NOT NULL,
	"average_cost_cents" integer NOT NULL,
	"market_exposure_cents" integer NOT NULL,
	"realized_pnl_cents" integer DEFAULT 0 NOT NULL,
	"unrealized_pnl_cents" integer DEFAULT 0 NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kalshi_trade_id" text NOT NULL,
	"ticker" text NOT NULL,
	"side" text NOT NULL,
	"action" text NOT NULL,
	"count" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"realized_pnl_cents" integer,
	"executed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_balances" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_kalshi_credentials" ADD COLUMN "last_fill_executed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_kalshi_credentials" ADD COLUMN "last_polled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_ticker_markets_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."markets"("ticker") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_ticker_markets_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."markets"("ticker") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_ticker_markets_ticker_fk" FOREIGN KEY ("ticker") REFERENCES "public"."markets"("ticker") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_balances" ADD CONSTRAINT "user_balances_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_kalshi_order_id_unique" ON "orders" USING btree ("user_id","kalshi_order_id");--> statement-breakpoint
CREATE INDEX "orders_user_status_idx" ON "orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_user_ticker_side_unique" ON "positions" USING btree ("user_id","ticker","side");--> statement-breakpoint
CREATE INDEX "positions_user_idx" ON "positions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_user_kalshi_trade_id_unique" ON "trades" USING btree ("user_id","kalshi_trade_id");--> statement-breakpoint
CREATE INDEX "trades_user_executed_at_idx" ON "trades" USING btree ("user_id","executed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trades_user_ticker_executed_at_idx" ON "trades" USING btree ("user_id","ticker","executed_at");