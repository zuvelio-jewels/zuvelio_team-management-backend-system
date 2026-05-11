-- AlterTable
ALTER TABLE "User" ADD COLUMN "empcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_empcode_key" ON "User"("empcode");
