-- Add error field to slskd_downloads
ALTER TABLE `slskd_downloads` ADD COLUMN `error` TEXT NULL AFTER `status`;

-- Update status comment to include new statuses
-- Note: MySQL doesn't support comments on columns via ALTER, but status field 
-- already supports VARCHAR(50) which accommodates: queued_locally, pending, 
-- downloading, organizing, completed, failed
