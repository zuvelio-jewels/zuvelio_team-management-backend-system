#!/usr/bin/env node

require('dotenv').config();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get database URL from environment
// Priority: DATABASE_PUBLIC_URL (Railway) > DATABASE_URL (local)
const DB_URL = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;

if (!DB_URL) {
    console.error('❌ ERROR: DATABASE_URL or DATABASE_PUBLIC_URL not set in .env');
    process.exit(1);
}

// Create backups directory if it doesn't exist
const backupDir = path.join(__dirname, 'backups');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log('📁 Created backups directory');
}

// Generate backup filename with timestamp
const date = new Date().toISOString().split('T')[0];
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const filename = `backup_${date}_${timestamp}.sql`;
const filePath = path.join(backupDir, filename);

console.log('🔄 Starting database backup...');
console.log(`📅 Backup file: ${filename}`);

// Execute pg_dump
exec(`pg_dump "${DB_URL}" > "${filePath}"`, (error, stdout, stderr) => {
    if (error) {
        console.error(`❌ Backup failed: ${error.message}`);
        if (stderr) console.error(`Error details: ${stderr}`);
        process.exit(1);
    }

    // Get file size
    const stats = fs.statSync(filePath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

    console.log(`✅ Backup completed successfully!`);
    console.log(`📊 File size: ${sizeInMB} MB`);
    console.log(`💾 Location: ${filePath}`);

    // Rotate old backups (keep last 7 days)
    rotateBackups(backupDir);
});

/**
 * Delete backups older than 7 days
 */
function rotateBackups(dir) {
    const files = fs.readdirSync(dir);
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        const fileAge = now - stats.mtimeMs;

        if (fileAge > sevenDaysMs) {
            try {
                fs.unlinkSync(filePath);
                deletedCount++;
                console.log(`🗑️  Deleted old backup: ${file}`);
            } catch (err) {
                console.error(`⚠️  Failed to delete ${file}: ${err.message}`);
            }
        }
    });

    if (deletedCount === 0) {
        console.log(`📌 No old backups to delete (keeping backups from last 7 days)`);
    }

    // Summary
    const remaining = fs.readdirSync(dir).length;
    console.log(`📂 Total backups: ${remaining}`);
}
