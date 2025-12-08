#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    reset: '\x1b[0m',
    bright: '\x1b[1m'
};

async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    let colorPrefix = colors.cyan;
    
    if (level === 'ERROR') colorPrefix = colors.red;
    else if (level === 'SUCCESS') colorPrefix = colors.green;
    else if (level === 'WARN') colorPrefix = colors.yellow;
    else if (level === 'STEP') colorPrefix = colors.magenta;
    
    console.log(`${colors.bright}[${timestamp}]${colors.reset} ${colorPrefix}[${level}]${colors.reset} ${message}`);
}

function runCommand(command, args, scriptDir, options = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            stdio: 'inherit',
            shell: true,
            cwd: scriptDir,
            ...options
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`Process exited with code ${code}`));
            } else {
                resolve(code);
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

function findLatestFile(dir, pattern) {
    try {
        const files = fs.readdirSync(dir)
            .filter(f => f.includes(pattern))
            .map(f => ({
                name: f,
                path: path.join(dir, f),
                time: fs.statSync(path.join(dir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        return files.length > 0 ? files[0].name : null;
    } catch (err) {
        return null;
    }
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
${colors.bright}${colors.cyan}Bitcoin Registry Recovery Pipeline${colors.reset}

${colors.green}Usage:${colors.reset}
  node recover.mjs [registry-path]

${colors.green}Example:${colors.reset}
  node recover.mjs "C:\\Users\\Your\\LocalFilePath\\bns-output\\Registry\\"   // make sure to change

${colors.yellow}Pipeline Steps:${colors.reset}
  1. duplicate-validator.mjs    → Scan registry for duplicates
  2. duplicate-competition.mjs  → Identify winners vs losers
  3. duplicate-remover.mjs      → Remove loser sats locally

${colors.cyan}Default registry path:${colors.reset}
  C:\\Users\\zmaki\\Desktop\\Work\\BNS registry\\bns-output\\Registry\\
        `);
        process.exit(0);
    }

    let registryPath = args[0] || 'C:\\Users\\Your\\LocalFilePath\\bns-output\\Registry\\';   // make sure to change
    
    // Sanitize path: remove quotes, normalize slashes
    registryPath = registryPath.replace(/^["']|["']$/g, '').trim();
    
    // Ensure trailing backslash for Windows paths
    if (!registryPath.endsWith('\\')) {
        registryPath += '\\';
    }

    if (!fs.existsSync(registryPath)) {
        await log(`Registry path not found: ${registryPath}`, 'ERROR');
        process.exit(1);
    }

    try {
        console.log(`\n${colors.bright}${colors.magenta}${'═'.repeat(80)}${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}  BITMAP REGISTRY RECOVERY PIPELINE${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}${'═'.repeat(80)}${colors.reset}\n`);

        await log(`Registry path: ${registryPath}`, 'STEP');
        await log(`Starting 3-step recovery pipeline...`, 'STEP');

        // Step 1: Validate duplicates
        console.log(`\n${colors.bright}${colors.yellow}[STEP 1/3] Running duplicate validator...${colors.reset}\n`);
        await log(`Scanning registry for duplicate blocks and sats`, 'INFO');
        
        try {
            const validatorDir = 'C:\\Users\\zmaki\\Desktop\\Work\\Bitmap Indexer\\sat comp';
            await runCommand('node', ['duplicate-validator.mjs', registryPath], validatorDir);
        } catch (err) {
            await log(`Validator failed: ${err.message}`, 'ERROR');
            process.exit(1);
        }

        // Find the generated validation report
        const validatorDir = 'C:\\Users\\zmaki\\Desktop\\Work\\Bitmap Indexer\\sat comp';
        const validationReport = findLatestFile(validatorDir, 'duplicate-validation-');
        if (!validationReport) {
            await log(`No validation report generated`, 'ERROR');
            process.exit(1);
        }

        await log(`✅ Validation complete: ${validationReport}`, 'SUCCESS');

        // Step 2: Run competition
        console.log(`\n${colors.bright}${colors.yellow}[STEP 2/3] Running competition resolver...${colors.reset}\n`);
        await log(`Resolving winners vs losers from registry`, 'INFO');

        try {
            await runCommand('node', ['duplicate-competition.mjs', validationReport, registryPath], validatorDir);
        } catch (err) {
            await log(`Competition resolver failed: ${err.message}`, 'ERROR');
            process.exit(1);
        }

        // Find the generated competition report
        const competitionReport = findLatestFile(validatorDir, 'duplicate-competition-');
        if (!competitionReport) {
            await log(`No competition report generated`, 'ERROR');
            process.exit(1);
        }

        await log(`✅ Competition complete: ${competitionReport}`, 'SUCCESS');

        // Step 3: Remove losers
        console.log(`\n${colors.bright}${colors.yellow}[STEP 3/3] Running loser remover...${colors.reset}\n`);
        await log(`Removing loser sats from sat_*.json files locally`, 'INFO');

        try {
            await runCommand('node', ['duplicate-remover.mjs', competitionReport, registryPath], validatorDir);
        } catch (err) {
            await log(`Loser remover failed: ${err.message}`, 'ERROR');
            process.exit(1);
        }

        // Find the generated removal report
        const removalReport = findLatestFile(validatorDir, 'duplicate-removal-');
        if (!removalReport) {
            await log(`No removal report generated`, 'ERROR');
            process.exit(1);
        }

        await log(`✅ Removal complete: ${removalReport}`, 'SUCCESS');

        // Final summary
        console.log(`\n${colors.bright}${colors.magenta}${'═'.repeat(80)}${colors.reset}`);
        console.log(`${colors.bright}${colors.green}RECOVERY PIPELINE COMPLETE${colors.reset}`);
        console.log(`${colors.bright}${colors.magenta}${'═'.repeat(80)}${colors.reset}\n`);

        console.log(`${colors.bright}Generated Reports:${colors.reset}`);
        console.log(`  1. ${colors.cyan}${validationReport}${colors.reset}`);
        console.log(`  2. ${colors.cyan}${competitionReport}${colors.reset}`);
        console.log(`  3. ${colors.cyan}${removalReport}${colors.reset}`);
        console.log(`\n${colors.yellow}Next Steps:${colors.reset}`);
        console.log(`  • Review ${removalReport} for removed entries`);
        console.log(`  • Verify sat_*.json files locally`);
        console.log(`  • Push changes to GitHub when ready\n`);

        await log(`All steps completed successfully!`, 'SUCCESS');

    } catch (err) {
        await log(`Pipeline failed: ${err.message}`, 'ERROR');
        console.error(err.stack);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`${colors.red}Unexpected error: ${err.message}${colors.reset}`);
    process.exit(1);
});