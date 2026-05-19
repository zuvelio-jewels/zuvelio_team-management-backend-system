-- AlterTable
ALTER TABLE "TimeLog" ADD COLUMN     "operationId" INTEGER;

-- CreateTable
CREATE TABLE "ProjectionOperation" (
    "id" SERIAL NOT NULL,
    "projectionId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "allocatedMinutes" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectionOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectionOperation_projectionId_idx" ON "ProjectionOperation"("projectionId");

-- CreateIndex
CREATE INDEX "ProjectionOperation_status_idx" ON "ProjectionOperation"("status");

-- AddForeignKey
ALTER TABLE "ProjectionOperation" ADD CONSTRAINT "ProjectionOperation_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "Projection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLog" ADD CONSTRAINT "TimeLog_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ProjectionOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
