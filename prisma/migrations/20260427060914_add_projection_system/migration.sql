-- CreateTable
CREATE TABLE "Projection" (
    "id" SERIAL NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "createdByAdminId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allocatedMinutes" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "employeeAcceptedAt" TIMESTAMP(3),
    "employeeRejectedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeLog" (
    "id" SERIAL NOT NULL,
    "projectionId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "sessionStart" TIMESTAMP(3) NOT NULL,
    "sessionEnd" TIMESTAMP(3),
    "allocatedDuration" INTEGER NOT NULL,
    "actualDuration" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Break" (
    "id" SERIAL NOT NULL,
    "timeLogId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "duration" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Break_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "projectionId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PROJECTION_ASSIGNED',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actionUrl" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "isDismissed" BOOLEAN NOT NULL DEFAULT false,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectionAction" (
    "id" SERIAL NOT NULL,
    "projectionId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "actionType" TEXT NOT NULL,
    "details" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectionAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Projection_employeeId_idx" ON "Projection"("employeeId");

-- CreateIndex
CREATE INDEX "Projection_createdByAdminId_idx" ON "Projection"("createdByAdminId");

-- CreateIndex
CREATE INDEX "Projection_status_idx" ON "Projection"("status");

-- CreateIndex
CREATE INDEX "Projection_assignedAt_idx" ON "Projection"("assignedAt");

-- CreateIndex
CREATE INDEX "TimeLog_projectionId_idx" ON "TimeLog"("projectionId");

-- CreateIndex
CREATE INDEX "TimeLog_employeeId_idx" ON "TimeLog"("employeeId");

-- CreateIndex
CREATE INDEX "TimeLog_sessionStart_idx" ON "TimeLog"("sessionStart");

-- CreateIndex
CREATE INDEX "Break_timeLogId_idx" ON "Break"("timeLogId");

-- CreateIndex
CREATE INDEX "Notification_employeeId_idx" ON "Notification"("employeeId");

-- CreateIndex
CREATE INDEX "Notification_projectionId_idx" ON "Notification"("projectionId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "ProjectionAction_projectionId_idx" ON "ProjectionAction"("projectionId");

-- CreateIndex
CREATE INDEX "ProjectionAction_employeeId_idx" ON "ProjectionAction"("employeeId");

-- CreateIndex
CREATE INDEX "ProjectionAction_actionType_idx" ON "ProjectionAction"("actionType");

-- AddForeignKey
ALTER TABLE "Projection" ADD CONSTRAINT "Projection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projection" ADD CONSTRAINT "Projection_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLog" ADD CONSTRAINT "TimeLog_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "Projection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeLog" ADD CONSTRAINT "TimeLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Break" ADD CONSTRAINT "Break_timeLogId_fkey" FOREIGN KEY ("timeLogId") REFERENCES "TimeLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "Projection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectionAction" ADD CONSTRAINT "ProjectionAction_projectionId_fkey" FOREIGN KEY ("projectionId") REFERENCES "Projection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectionAction" ADD CONSTRAINT "ProjectionAction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
