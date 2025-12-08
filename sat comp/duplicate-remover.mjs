#!/usr/bin/env node

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
    bright: '\x1b[1m',
    reset: '\x1b[0m'
};

async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    let colorPrefix = colors.cyan;
    
    if (level === 'ERROR') colorPrefix = colors.red;
    else if (level === 'SUCCESS') colorPrefix = colors.green;
    else if (level === 'WARN') colorPrefix = colors.yellow;
    
    console.log(`${colors.bright}[${timestamp}]${colors.reset} ${colorPrefix}[${level}]${colors.reset} ${message}`);
}

// Find which sat_*.json file contains a sat entry
function findSatFile(registryPath, targetSat) {
    const files = fs.readdirSync(registryPath)
        .filter(f => f.startsWith('sat_') && f.endsWith('.json'));
    
    for (const file of files) {
        try {
            const content = JSON.parse(fs.readFileSync(path.join(registryPath, file), 'utf8'));
            
            if (Array.isArray(content)) {
                for (const entry of content) {
                    if (entry && typeof entry === 'object' && entry.sat === targetSat) {
                        return { file, content };
                    }
                }
            }
        } catch (err) {
            // Skip files that fail to parse
            continue;
        }
    }
    
    return null;
}

// Remove loser entry from sat file
function removeLoserFromFile(registryPath, satFile, loserSat) {
    const filePath = path.join(registryPath, satFile);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (Array.isArray(content)) {
        const filtered = content.filter(entry => entry.sat !== loserSat);
        
        if (filtered.length === content.length) {
            return { removed: false, reason: 'not_found' };
        }
        
        // Write back to file
        fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), 'utf8');
        return { removed: true, originalCount: content.length, newCount: filtered.length };
    }
    
    return { removed: false, reason: 'invalid_format' };
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
${colors.bright}Duplicate Loser Remover${colors.reset}
${colors.green}Usage:${colors.reset}
  node duplicate-remover.mjs <competition-report.json> [registry-path]

${colors.green}Example:${colors.reset}
  node duplicate-remover.mjs duplicate-competition-2025-11-29_22-00-00.json C:\\Users\\Your\\LocalFilePath\\bns-output\\Registry\\  // make sure to change

${colors.yellow}NOTE:${colors.reset} This removes loser sats from sat_*.json files LOCALLY.
Review the removal report before pushing to GitHub.
        `);
        process.exit(0);
    }
    
    if (args.length < 1) {
        console.error(`${colors.red}Error: Please provide competition report file${colors.reset}`);
        process.exit(1);
    }
    
    const reportFile = args[0];
    const registryPath = args[1] || 'C:\\Users\\Your\\LocalFilePath\\bns-output\\Registry\\';  ///make ure to change
    
    if (!fs.existsSync(reportFile)) {
        console.error(`${colors.red}Error: Report file not found: ${reportFile}${colors.reset}`);
        process.exit(1);
    }
    
    if (!fs.existsSync(registryPath)) {
        console.error(`${colors.red}Error: Registry path not found: ${registryPath}${colors.reset}`);
        process.exit(1);
    }
    
    try {
        await log(`📖 Reading competition report: ${reportFile}`, 'INFO');
        const reportContent = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        
        if (!reportContent.results || !reportContent.results.losers) {
            throw new Error('Invalid competition report format: missing results.losers');
        }
        
        const losers = reportContent.results.losers;
        await log(`Found ${losers.length} loser sats to remove`, 'INFO');
        
        const removalLog = {
            timestamp: new Date().toISOString(),
            competitionReport: reportFile,
            registryPath: registryPath,
            totalLosers: losers.length,
            removed: [],
            failed: [],
            notFound: []
        };
        
        for (let i = 0; i < losers.length; i++) {
            const loser = losers[i];
            const { block, sat } = loser;
            
            // Find which file contains this sat
            const result = findSatFile(registryPath, sat);
            
            if (!result) {
                removalLog.notFound.push({
                    block,
                    sat,
                    reason: 'sat_not_found_in_any_file'
                });
                await log(`⚠️  Sat ${sat} (block ${block}) not found in registry`, 'WARN');
                continue;
            }
            
            try {
                const removalResult = removeLoserFromFile(registryPath, result.file, sat);
                
                if (removalResult.removed) {
                    removalLog.removed.push({
                        block,
                        sat,
                        file: result.file,
                        entriesBefore: removalResult.originalCount,
                        entriesAfter: removalResult.newCount
                    });
                    await log(`✅ Removed sat ${sat} from ${result.file}`, 'SUCCESS');
                } else {
                    removalLog.failed.push({
                        block,
                        sat,
                        file: result.file,
                        reason: removalResult.reason
                    });
                    await log(`❌ Failed to remove sat ${sat}: ${removalResult.reason}`, 'ERROR');
                }
            } catch (err) {
                removalLog.failed.push({
                    block,
                    sat,
                    file: result.file,
                    reason: err.message
                });
                await log(`❌ Error removing sat ${sat}: ${err.message}`, 'ERROR');
            }
            
            // Progress indicator
            if ((i + 1) % 100 === 0) {
                await log(`Progress: ${i + 1}/${losers.length} processed`, 'INFO');
            }
        }
        
        // Generate removal report
        const timestamp = new Date();
        const dateStr = timestamp.toISOString().split('T')[0];
        const timeStr = timestamp.toTimeString().split(' ')[0].replace(/:/g, '-');
        const removalReportFile = `duplicate-removal-${dateStr}_${timeStr}.json`;
        
        const removalReportPath = path.join(__dirname, removalReportFile);
        fs.writeFileSync(removalReportPath, JSON.stringify(removalLog, null, 2), 'utf8');
        
        // Print summary
        console.log(`\n${colors.bright}${colors.green}REMOVAL SUMMARY:${colors.reset}`);
        console.log(`  Successfully removed: ${removalLog.removed.length}`);
        console.log(`  Failed to remove: ${removalLog.failed.length}`);
        console.log(`  Not found: ${removalLog.notFound.length}`);
        console.log(`\n${colors.green}Removal report saved: ${removalReportFile}${colors.reset}`);
        
        if (removalLog.failed.length > 0) {
            await log(`⚠️  ${removalLog.failed.length} removals failed - review report before GitHub push`, 'WARN');
        }
        
        if (removalLog.notFound.length > 0) {
            await log(`⚠️  ${removalLog.notFound.length} sats not found - they may already be removed`, 'WARN');
        }
        
        if (removalLog.removed.length === losers.length) {
            await log(`✅ All loser sats successfully removed!`, 'SUCCESS');
        }
        
    } catch (err) {
        await log(`💥 Fatal error: ${err.message}`, 'ERROR');
        console.error(err.stack);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`${colors.red}Unexpected error: ${err.message}${colors.reset}`);
    process.exit(1);
});