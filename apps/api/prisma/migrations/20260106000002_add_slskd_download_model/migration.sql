-- CreateEnum: SlskdDownloadStatus
-- Note: MySQL doesn't have standalone ENUMs; they're defined inline with the column

-- CreateTable
CREATE TABLE `slskd_downloads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `connection_id` INTEGER NOT NULL,
    `username` VARCHAR(255) NOT NULL,
    `search_id` VARCHAR(255) NULL,
    `artist_name` VARCHAR(255) NOT NULL,
    `album_name` VARCHAR(255) NULL,
    `album_year` INTEGER NULL,
    `filename` VARCHAR(500) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `slskd_id` VARCHAR(255) NULL,
    `status` ENUM('pending', 'downloading', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `download_path` VARCHAR(500) NULL,
    `final_path` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `slskd_downloads_connection_id_idx`(`connection_id`),
    INDEX `slskd_downloads_status_idx`(`status`),
    INDEX `slskd_downloads_artist_name_album_name_idx`(`artist_name`, `album_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `slskd_downloads` ADD CONSTRAINT `slskd_downloads_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
