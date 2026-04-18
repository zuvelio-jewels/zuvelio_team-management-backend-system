#!/usr/bin/env node

const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

const MAX_RETRIES = Number(process.env.MAX_RETRIES || 10);
const RETRY_DELAY_SECONDS = Number(process.env.RETRY_DELAY || 3);
const PRISMA_CLI_JS = path.join(
    process.cwd(),
    'node_modules',
    'prisma',
    'build',
    'index.js',
);

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            env: process.env,
        });

        child.on('close', (code) => resolve(code ?? 1));
        child.on('error', () => resolve(1));
    });
}

async function runMigrationsWithRetry() {
    let attempt = 1;

    while (attempt <= MAX_RETRIES) {
        const code = await runCommand(process.execPath, [
            PRISMA_CLI_JS,
            'migrate',
            'deploy',
        ]);

        if (code === 0) {
            return;
        }

        if (attempt >= MAX_RETRIES) {
            console.error(`Prisma migration failed after ${attempt} attempts`);
            process.exit(1);
        }

        console.log(`Migration attempt ${attempt} failed. Retrying in ${RETRY_DELAY_SECONDS}s...`);
        attempt += 1;
        await delay(RETRY_DELAY_SECONDS * 1000);
    }
}

async function main() {
    console.log('=== ENTRYPOINT START ===');
    console.log(`Node version: ${process.version}`);
    console.log(`PORT env: ${process.env.PORT || 'not set'}`);
    console.log(`DATABASE_URL set: ${process.env.DATABASE_URL ? 'yes' : 'no'}`);

    console.log('Running Prisma migrations...');
    await runMigrationsWithRetry();

    console.log('=== Migrations complete. Starting NestJS ===');

    const appEntryFile = 'dist/src/main.js';
    if (!existsSync(appEntryFile)) {
        console.error('Build output not found at dist/src/main.js. Run "npm run build" first.');
        process.exit(1);
    }

    const exitCode = await runCommand(process.execPath, [appEntryFile]);
    process.exit(exitCode);
}

main().catch((error) => {
    console.error('Startup failed:', error);
    process.exit(1);
});
