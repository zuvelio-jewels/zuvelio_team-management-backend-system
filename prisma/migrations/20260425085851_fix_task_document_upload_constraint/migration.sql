-- DropForeignKey
ALTER TABLE "TaskDocument" DROP CONSTRAINT "TaskDocument_uploadedById_fkey";

-- AlterTable
ALTER TABLE "TaskDocument" ALTER COLUMN "uploadedById" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "TaskDocument" ADD CONSTRAINT "TaskDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
