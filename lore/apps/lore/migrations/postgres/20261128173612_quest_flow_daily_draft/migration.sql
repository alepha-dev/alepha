-- The cumulative flow counts drafts in a band of their own (#Q4377, epic #E178).
-- One nullable column, no default, so a plain ADD COLUMN and never a rebuild.
-- Past rows are not rewritten: a reader takes their absent `draft` as 0.
ALTER TABLE "quest_flow_daily" ADD COLUMN "draft" integer;