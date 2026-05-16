-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "allocatedMinutes" INTEGER;

-- CreateTable
CREATE TABLE "TaskOperation" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTimeLog" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "sessionStart" TIMESTAMP(3) NOT NULL,
    "sessionEnd" TIMESTAMP(3),
    "allocatedDuration" INTEGER NOT NULL DEFAULT 0,
    "actualDuration" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "switchReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTimeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskBreak" (
    "id" SERIAL NOT NULL,
    "timeLogId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "duration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskBreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskOperation_taskId_idx" ON "TaskOperation"("taskId");

-- CreateIndex
CREATE INDEX "TaskTimeLog_taskId_idx" ON "TaskTimeLog"("taskId");

-- CreateIndex
CREATE INDEX "TaskTimeLog_employeeId_idx" ON "TaskTimeLog"("employeeId");

-- CreateIndex
CREATE INDEX "TaskTimeLog_sessionStart_idx" ON "TaskTimeLog"("sessionStart");

-- CreateIndex
CREATE INDEX "TaskTimeLog_status_idx" ON "TaskTimeLog"("status");

-- CreateIndex
CREATE INDEX "TaskBreak_timeLogId_idx" ON "TaskBreak"("timeLogId");

-- AddForeignKey
ALTER TABLE "TaskOperation" ADD CONSTRAINT "TaskOperation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeLog" ADD CONSTRAINT "TaskTimeLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimeLog" ADD CONSTRAINT "TaskTimeLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskBreak" ADD CONSTRAINT "TaskBreak_timeLogId_fkey" FOREIGN KEY ("timeLogId") REFERENCES "TaskTimeLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
