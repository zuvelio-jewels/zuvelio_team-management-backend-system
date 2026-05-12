-- Add activeWindow column to ActivityEvent
-- Stores the active application window title and process name at the time of the event.
-- Format: "Window Title|ProcessName"  (nullable — pre-migration rows and browser events have no value)
ALTER TABLE "ActivityEvent" ADD COLUMN "activeWindow" TEXT;
