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
    reset: '\x1b[0m',
    bright: '\x1b[1m'
};

async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    let colorPrefix = colors.cyan;
    
    if (level === 'ERROR') colorPrefix = colors.red;
    else if (level === 'SUCCESS') colorPrefix = colors.green;
    else if (level === 'WARN') colorPrefix = colors.yellow;
    
    console.log(`${colors.bright}[${timestamp}]${colors.reset} ${colorPrefix}[${level}]${colors.reset} ${message}`);
}

// Parse duplicate report to extract block→sats mapping
function parseDuplicateReport(reportContent) {
    const duplicates = {}; // blockHeight → [sats]
    
    const blockMatches = reportContent.match(/Block (\d+):([\s\S]*?)(?=Block \d+:|$)/g) || [];
    
    for (const blockMatch of blockMatches) {
        const blockHeightMatch = blockMatch.match(/Block (\d+):/);
        const blockHeight = parseInt(blockHeightMatch[1]);
        
        const satMatches = blockMatch.match(/Sat: (\d+)/g) || [];
        const sats = satMatches.map(m => parseInt(m.match(/Sat: (\d+)/)[1]));
        
        if (sats.length > 1) {
            duplicates[blockHeight] = sats;
        }
    }
    
    return duplicates;
}

// Load registry files and build block→sat index
async function loadRegistryIndex(registryPath) {
    const blockToSat = {}; // blockHeight → registeredSat
    const files = fs.readdirSync(registryPath)
        .filter(f => f.startsWith('0-') && f.endsWith('.json'))
        .sort((a, b) => {
            const aStart = parseInt(a.split('-')[0]);
            const bStart = parseInt(b.split('-')[0]);
            return aStart - bStart;
        });
    
    let filesLoaded = 0;
    for (const file of files) {
        try {
            const content = JSON.parse(fs.readFileSync(path.join(registryPath, file), 'utf8'));
            
            if (Array.isArray(content)) {
                for (const entry of content) {
                    if (entry && typeof entry === 'object' && entry.block && entry.sat) {
                        blockToSat[entry.block] = entry.sat;
                    }
                }
            }
            
            filesLoaded++;
            if (filesLoaded % 10 === 0) {
                await log(`Registry files loaded: ${filesLoaded}/${files.length}`, 'DEBUG');
            }
        } catch (err) {
            await log(`Failed to load registry file ${file}: ${err.message}`, 'WARN');
        }
    }
    
    await log(`✅ Loaded ${filesLoaded} registry files`, 'SUCCESS');
    return blockToSat;
}

// Determine winners vs losers
function resolveCompetition(duplicates, blockToSat) {
    const results = {
        winners: [],
        losers: [],
        unresolved: [] // blocks where winner not found in registry
    };
    
    for (const [blockHeight, sats] of Object.entries(duplicates)) {
        const blockNum = parseInt(blockHeight);
        const registeredSat = blockToSat[blockNum];
        
        if (registeredSat === undefined) {
            results.unresolved.push({
                block: blockNum,
                duplicateSats: sats
            });
            continue;
        }
        
        const winner = registeredSat;
        const losers = sats.filter(s => s !== winner);
        
        if (losers.length > 0) {
            results.winners.push({
                block: blockNum,
                sat: winner
            });
            
            for (const loserSat of losers) {
                results.losers.push({
                    block: blockNum,
                    sat: loserSat
                });
            }
        }
    }
    
    return results;
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
${colors.bright}Duplicate Competition Resolver${colors.reset}
${colors.green}Usage:${colors.reset}
  node duplicate-competition.mjs <duplicate-report.txt> <registry-path>

${colors.green}Example:${colors.reset}
  node duplicate-competition.mjs duplicate-validation-2025-11-29_21-09-03.txt C:\\Users\\Your\\LocalFilePath\\bns-output\\Registry\\    // make sure to change
        `);
        process.exit(0);
    }
    
    // Accept 1 or 2 args: report file + optional registry path
    if (args.length < 1) {
        console.error(`${colors.red}Error: Please provide duplicate report file${colors.reset}`);
        process.exit(1);
    }
    
    const reportFile = args[0];
    const registryPath = args[1] || 'C:\\Users\\Your\\LocalFilePath\\bns-output\\Registry\\';   // make sure to change
    
    if (!fs.existsSync(reportFile)) {
        console.error(`${colors.red}Error: Report file not found: ${reportFile}${colors.reset}`);
        process.exit(1);
    }
    
    if (!fs.existsSync(registryPath)) {
        console.error(`${colors.red}Error: Registry path not found: ${registryPath}${colors.reset}`);
        process.exit(1);
    }
    
    try {
        await log(`📖 Reading duplicate report: ${reportFile}`, 'INFO');
        const reportContent = fs.readFileSync(reportFile, 'utf8');
        const duplicates = parseDuplicateReport(reportContent);
        
        await log(`Found ${Object.keys(duplicates).length} duplicate blocks`, 'INFO');
        
        await log(`📚 Loading registry files from: ${registryPath}`, 'INFO');
        const blockToSat = await loadRegistryIndex(registryPath);
        
        await log(`🏆 Resolving competition...`, 'INFO');
        const results = resolveCompetition(duplicates, blockToSat);
        
        // Generate report
        const timestamp = new Date();
        const dateStr = timestamp.toISOString().split('T')[0];
        const timeStr = timestamp.toTimeString().split(' ')[0].replace(/:/g, '-');
        const outputFile = `duplicate-competition-${dateStr}_${timeStr}.json`;
        
        const report = {
            generated: timestamp.toISOString(),
            inputReport: reportFile,
            registryPath: registryPath,
            summary: {
                totalDuplicateBlocks: Object.keys(duplicates).length,
                winnersResolved: results.winners.length,
                losersIdentified: results.losers.length,
                unresolvedBlocks: results.unresolved.length
            },
            results: results
        };
        
        const outputPath = path.join(__dirname, outputFile);
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
        
        await log(`✅ Competition resolved!`, 'SUCCESS');
        console.log(`\n${colors.bright}${colors.green}SUMMARY:${colors.reset}`);
        console.log(`  Winners resolved: ${results.winners.length}`);
        console.log(`  Losers identified: ${results.losers.length}`);
        console.log(`  Unresolved blocks: ${results.unresolved.length}`);
        console.log(`\n${colors.green}Report saved: ${outputFile}${colors.reset}`);
        
        if (results.unresolved.length > 0) {
            await log(`⚠️  ${results.unresolved.length} blocks could not be resolved (not in registry)`, 'WARN');
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