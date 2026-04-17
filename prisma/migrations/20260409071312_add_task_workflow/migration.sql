/*
  Warnings:

  - You are about to drop the column `description` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Task` table. All the data in the column will be lost.
  - Added the required column `allottedFromId` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `assignedToId` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cabin` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `completeBy` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `taskDetail` to the `Task` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Task` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_userId_fkey";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "description",
DROP COLUMN "status",
DROP COLUMN "title",
DROP COLUMN "userId",
ADD COLUMN     "alert" TEXT,
ADD COLUMN     "allottedFromId" INTEGER NOT NULL,
ADD COLUMN     "assignedToId" INTEGER NOT NULL,
ADD COLUMN     "cabin" TEXT NOT NULL,
ADD COLUMN     "completeBy" TEXT NOT NULL,
ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "isPresent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "personStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "qcCheck" TEXT,
ADD COLUMN     "remark" TEXT,
ADD COLUMN     "taskDetail" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updatedBy" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_allottedFromId_fkey" FOREIGN KEY ("allottedFromId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
