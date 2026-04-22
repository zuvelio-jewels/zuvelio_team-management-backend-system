#!/usr/bin/env node

import 'dotenv/config';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get database URL from environment
// Priority: DATABASE_PUBLIC_URL (Railway) > DATABASE_URL (local)
const DB_URL = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;

if (!DB_URL) {
    console.error('❌ ERROR: DATABASE_URL or DATABASE_PUBLIC_URL not set in .env');
    process.exit(1);
}

const backupDir = path.join(__dirname, 'backups');

// Get backup file from arguments
const backupFile = process.argv[2];

if (!backupFile) {
    console.log('📂 Available backups:');
    const files = fs.readdirSync(backupDir).sort().reverse();

    if (files.length === 0) {
        console.log('❌ No backups found in ./backups/');
        process.exit(1);
    }

    files.forEach((file, index) => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`  ${index + 1}. ${file} (${sizeInMB} MB)`);
    });

    console.log('\n📖 Usage: node restore.js <backup-file-name>');
    console.log('📖 Example: node restore.js backup_2026-04-22_10-30-45-123-Z.sql');
    process.exit(0);
}

const filePath = path.join(backupDir, backupFile);

if (!fs.existsSync(filePath)) {
    console.error(`❌ Backup file not found: ${backupFile}`);
    process.exit(1);
}

// Confirm restore
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const stats = fs.statSync(filePath);
const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log(`\n⚠️  WARNING: This will restore database from backup!`);
console.log(`📅 File: ${backupFile}`);
console.log(`📊 Size: ${sizeInMB} MB`);
console.log(`\n🔴 This will OVERWRITE the current database!`);

rl.question('Type "YES" to confirm restore: ', (answer) => {
    rl.close();

    if (answer.toUpperCase() !== 'YES') {
        console.log('❌ Restore cancelled');
        process.exit(0);
    }

    console.log('\n🔄 Starting database restore...');

    // Execute psql restore
    exec(`psql "${DB_URL}" < "${filePath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Restore failed: ${error.message}`);
            if (stderr) console.error(`Error details: ${stderr}`);
            process.exit(1);
        }

        console.log(`✅ Database restored successfully!`);
        console.log(`📅 Restored from: ${backupFile}`);
    });
});
