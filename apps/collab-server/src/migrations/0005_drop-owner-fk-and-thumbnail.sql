UPDATE "boards" SET "owner_id" = NULL;--> statement-breakpoint
ALTER TABLE "boards" DROP CONSTRAINT "boards_owner_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "boards" DROP COLUMN "thumbnail";--> statement-breakpoint
ALTER TABLE "boards" DROP COLUMN "thumbnail_seq";