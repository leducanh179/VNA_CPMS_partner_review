-- CreateEnum
CREATE TYPE "CampaignCommentReactionType" AS ENUM ('LIKE', 'DISLIKE');

-- CreateTable
CREATE TABLE "campaign_comments" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "author_actor_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "parent_comment_id" UUID,
    "reply_to_comment_id" UUID,
    "record_version" INTEGER NOT NULL DEFAULT 1,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by_actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_comment_reactions" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "type" "CampaignCommentReactionType" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_comment_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_comments_campaign_id_parent_comment_id_created_at_idx" ON "campaign_comments"("campaign_id", "parent_comment_id", "created_at");

-- CreateIndex
CREATE INDEX "campaign_comments_author_actor_id_created_at_idx" ON "campaign_comments"("author_actor_id", "created_at");

-- CreateIndex
CREATE INDEX "campaign_comments_deleted_at_idx" ON "campaign_comments"("deleted_at");

-- CreateIndex
CREATE INDEX "campaign_comment_reactions_actor_id_updated_at_idx" ON "campaign_comment_reactions"("actor_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_comment_reactions_comment_id_actor_id_key" ON "campaign_comment_reactions"("comment_id", "actor_id");

-- AddForeignKey
ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_author_actor_id_fkey" FOREIGN KEY ("author_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_deleted_by_actor_id_fkey" FOREIGN KEY ("deleted_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "campaign_comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_comments" ADD CONSTRAINT "campaign_comments_reply_to_comment_id_fkey" FOREIGN KEY ("reply_to_comment_id") REFERENCES "campaign_comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_comment_reactions" ADD CONSTRAINT "campaign_comment_reactions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "campaign_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_comment_reactions" ADD CONSTRAINT "campaign_comment_reactions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
