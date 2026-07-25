CREATE TABLE "order_history" (
	"id" text PRIMARY KEY NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"income" double precision NOT NULL,
	"distance" double precision NOT NULL,
	"minutes" double precision,
	"stores" integer DEFAULT 1 NOT NULL,
	"destination" text DEFAULT '' NOT NULL,
	"decision" text NOT NULL,
	"score" integer,
	"source" text
);
