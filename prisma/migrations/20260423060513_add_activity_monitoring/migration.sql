-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isMonitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "keyCode" TEXT,
    "mouseX" INTEGER,
    "mouseY" INTEGER,
    "clickType" TEXT,
    "taskId" INTEGER,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivitySummary" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hour" INTEGER NOT NULL,
    "totalKeystrokes" INTEGER NOT NULL DEFAULT 0,
    "totalClicks" INTEGER NOT NULL DEFAULT 0,
    "totalMouseMovement" INTEGER NOT NULL DEFAULT 0,
    "idleTimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "taskId" INTEGER,
    "isWorkingHours" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivitySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringConfig" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "isMonitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "startWorkHour" INTEGER NOT NULL DEFAULT 9,
    "endWorkHour" INTEGER NOT NULL DEFAULT 18,
    "idleThresholdMinutes" INTEGER NOT NULL DEFAULT 5,
    "departmentId" INTEGER,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_idx" ON "ActivityEvent"("userId");

-- CreateIndex
CREATE INDEX "ActivityEvent_timestamp_idx" ON "ActivityEvent"("timestamp");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_timestamp_idx" ON "ActivityEvent"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "ActivityEvent_taskId_idx" ON "ActivityEvent"("taskId");

-- CreateIndex
CREATE INDEX "ActivitySummary_userId_idx" ON "ActivitySummary"("userId");

-- CreateIndex
CREATE INDEX "ActivitySummary_userId_date_idx" ON "ActivitySummary"("userId", "date");

-- CreateIndex
CREATE INDEX "ActivitySummary_date_idx" ON "ActivitySummary"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ActivitySummary_userId_date_hour_taskId_key" ON "ActivitySummary"("userId", "date", "hour", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringConfig_userId_key" ON "MonitoringConfig"("userId");

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivitySummary" ADD CONSTRAINT "ActivitySummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringConfig" ADD CONSTRAINT "MonitoringConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
