-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_allottedFromId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "TaskNoteHistory" DROP CONSTRAINT "TaskNoteHistory_authorId_fkey";

-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "allottedFromId" DROP NOT NULL,
ALTER COLUMN "assignedToId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "TaskNoteHistory" ALTER COLUMN "authorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_allottedFromId_fkey" FOREIGN KEY ("allottedFromId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNoteHistory" ADD CONSTRAINT "TaskNoteHistory_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
