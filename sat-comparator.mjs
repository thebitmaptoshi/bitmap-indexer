#!/usr/bin/env node

/* A script to compare the bitmap blockheight and sat association between
multiple different files and file sources. Expects a JSON array with "sat"
and "block"/"blockheight" data for a valid source. Compares file1 vs file2
to determine differences by sat-to-block association and vice versa. Logs
the differences in sats found in individual files or sats associated with 
multiple blocks. Find the diffs and compare the data, can be used with
validator.mjs to run large repos/directories and output reports. */
    

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

// ANSI color codes for better output readability
const colors = {
    yellow: '\x1b[33m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m'
};

class SatComparator {
    constructor() {
        this.file1Data = new Map(); // sat -> { block, source: 'file1' }
        this.file2Data = new Map(); // sat -> { block, source: 'file2' }
        this.differences = [];
        this.stats = {
            file1Count: 0,
            file2Count: 0,
            matches: 0,
            conflicts: 0,
            file1Only: 0,
            file2Only: 0
        };
    }

    // Load and parse JSON file with flexible property name handling
    async loadFile(filePath, label) {
        try {
            console.log(`${colors.cyan}Loading ${label}: ${filePath}${colors.reset}`);
            
            let rawData;
            
            // Check if it's a URL (HTTPS or HTTP)
            if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
                rawData = await this.fetchFromURL(filePath);
            } else {
                // Local file
                if (!fs.existsSync(filePath)) {
                    throw new Error(`File not found: ${filePath}`);
                }
                rawData = fs.readFileSync(filePath, 'utf8');
            }

            const jsonData = JSON.parse(rawData);
            
            if (!Array.isArray(jsonData)) {
                throw new Error(`Expected an array in ${filePath}, got ${typeof jsonData}`);
            }

            const dataMap = new Map();
            let processedCount = 0;

            for (const entry of jsonData) {
                // Handle both "block" and "blockheight" property names
                const sat = entry.sat;
                const block = entry.block || entry.blockheight;
                
                if (sat === undefined || block === undefined) {
                    console.warn(`${colors.yellow}Warning: Skipping invalid entry in ${label} - sat: ${sat}, block: ${block}${colors.reset}`);
                    continue;
                }

                dataMap.set(sat, { block, source: label });
                processedCount++;
            }

            console.log(`${colors.green}✓ Loaded ${processedCount} entries from ${label}${colors.reset}`);
            return dataMap;

        } catch (error) {
            console.error(`${colors.red}Error loading ${label}: ${error.message}${colors.reset}`);
            throw error;
        }
    }

    // Fetch content from HTTPS/HTTP URLs
    fetchFromURL(url) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https://') ? https : http;
            
            client.get(url, (res) => {
                let data = '';
                
                // Handle redirects
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    console.log(`${colors.yellow}Following redirect to: ${res.headers.location}${colors.reset}`);
                    return this.fetchFromURL(res.headers.location).then(resolve).catch(reject);
                }
                
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage} for ${url}`));
                    return;
                }
                
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', (error) => {
                reject(new Error(`Network error fetching ${url}: ${error.message}`));
            });
        });
    }

    // Compare the two datasets and identify differences
    async compareFiles(file1Path, file2Path) {
        console.log(`\n${colors.bright}=== SAT COMPARATOR ANALYSIS ===${colors.reset}\n`);

        // Load both files
        this.file1Data = await this.loadFile(file1Path, 'File 1');
        this.file2Data = await this.loadFile(file2Path, 'File 2');

        this.stats.file1Count = this.file1Data.size;
        this.stats.file2Count = this.file2Data.size;

        console.log(`\n${colors.bright}=== COMPARISON ANALYSIS ===${colors.reset}`);

        // Create block-to-sat mappings for block-centric analysis
        const file1BlockToSat = new Map();
        const file2BlockToSat = new Map();
        
        // Build reverse mappings (block -> sat)
        for (const [sat, data] of this.file1Data) {
            file1BlockToSat.set(data.block, sat);
        }
        for (const [sat, data] of this.file2Data) {
            file2BlockToSat.set(data.block, sat);
        }

        // Get all unique sat numbers from both files
        const allSats = new Set([...this.file1Data.keys(), ...this.file2Data.keys()]);
        
        for (const sat of allSats) {
            const file1Entry = this.file1Data.get(sat);
            const file2Entry = this.file2Data.get(sat);

            if (file1Entry && file2Entry) {
                // Sat exists in both files - check if blocks match
                if (file1Entry.block === file2Entry.block) {
                    this.stats.matches++;
                } else {
                    // Block height conflict!
                    this.differences.push({
                        type: 'CONFLICT',
                        sat: sat,
                        file1Block: file1Entry.block,
                        file2Block: file2Entry.block,
                        description: `Sat ${sat} has different blocks: File1=${file1Entry.block}, File2=${file2Entry.block}`
                    });
                    this.stats.conflicts++;
                }
            } else if (file1Entry && !file2Entry) {
                // Sat only exists in file 1
                this.differences.push({
                    type: 'FILE1_ONLY',
                    sat: sat,
                    file1Block: file1Entry.block,
                    file2Block: null,
                    description: `Sat ${sat} only exists in File1 (block ${file1Entry.block})`
                });
                this.stats.file1Only++;
            } else if (!file1Entry && file2Entry) {
                // Sat only exists in file 2
                this.differences.push({
                    type: 'FILE2_ONLY',
                    sat: sat,
                    file1Block: null,
                    file2Block: file2Entry.block,
                    description: `Sat ${sat} only exists in File2 (block ${file2Entry.block})`
                });
                this.stats.file2Only++;
            }
        }

        // Check for block conflicts (same block, different sats)
        const allBlocks = new Set([...file1BlockToSat.keys(), ...file2BlockToSat.keys()]);
        
        for (const block of allBlocks) {
            const file1Sat = file1BlockToSat.get(block);
            const file2Sat = file2BlockToSat.get(block);
            
            if (file1Sat && file2Sat && file1Sat !== file2Sat) {
                // Same block, different sats - this is critical!
                this.differences.push({
                    type: 'BLOCK_CONFLICT',
                    block: block,
                    file1Sat: file1Sat,
                    file2Sat: file2Sat,
                    description: `Block ${block} has different sats: File1→${file1Sat}, File2→${file2Sat}`
                });
            }
        }

        // Sort differences by sat number for easier reading
        this.differences.sort((a, b) => {
            if (a.sat && b.sat) return a.sat - b.sat;
            if (a.block && b.block) return a.block - b.block;
            return 0;
        });
    }

    // Display comprehensive results
    displayResults() {
        console.log(`\n${colors.bright}=== COMPARISON SUMMARY ===${colors.reset}`);
        console.log(`File 1 entries: ${colors.blue}${this.stats.file1Count}${colors.reset}`);
        console.log(`File 2 entries: ${colors.blue}${this.stats.file2Count}${colors.reset}`);
        console.log(`Conflicts (different blocks): ${colors.red}${this.stats.conflicts}${colors.reset}`);
        console.log(`File 1 only: ${colors.yellow}${this.stats.file1Only}${colors.reset}`);
        console.log(`File 2 only: ${colors.yellow}${this.stats.file2Only}${colors.reset}`);
        console.log(`Total differences found: ${colors.magenta}${this.differences.length}${colors.reset}`);

        if (this.differences.length === 0) {
            console.log(`\n${colors.green}${colors.bright}🎉 NO DIFFERENCES FOUND between the files.${colors.reset}`);
            return;
        }

        console.log(`\n${colors.bright}=== CRITICAL DIFFERENCES ===${colors.reset}\n`);

        // Group differences by type for better readability
        const conflictDiffs = this.differences.filter(d => d.type === 'CONFLICT');
        const blockConflictDiffs = this.differences.filter(d => d.type === 'BLOCK_CONFLICT');
        const file1OnlyDiffs = this.differences.filter(d => d.type === 'FILE1_ONLY');
        const file2OnlyDiffs = this.differences.filter(d => d.type === 'FILE2_ONLY');

        // Display BLOCK conflicts first (MOST CRITICAL - same block, different sats)
        if (blockConflictDiffs.length > 0) {
            console.log(`${colors.red}${colors.bright}🚨 BLOCK CONFLICTS (Same block, different sats): ${blockConflictDiffs.length} total${colors.reset}`);
            blockConflictDiffs.forEach((diff, index) => {
                console.log(`${colors.red}  ${index + 1}. Block ${diff.block}: File1→Sat ${diff.file1Sat}, File2→Sat ${diff.file2Sat}${colors.reset}`);
            });
            console.log();
        }

        // Display sat conflicts (same sat, different blocks)
        if (conflictDiffs.length > 0) {
            console.log(`${colors.red}${colors.bright}🔴 SAT CONFLICTS (Same sat, different blocks): ${conflictDiffs.length} total${colors.reset}`);
            conflictDiffs.forEach((diff, index) => {
                console.log(`${colors.red}  ${index + 1}. Sat ${diff.sat}: File1→Block ${diff.file1Block}, File2→Block ${diff.file2Block}${colors.reset}`);
            });
            console.log();
        }

        // Comment out the long lists of file-only entries
        /*
        // Display ALL entries only in file 1
        if (file1OnlyDiffs.length > 0) {
            console.log(`${colors.yellow}${colors.bright}🟡 ENTRIES ONLY IN FILE 1: ${file1OnlyDiffs.length} total${colors.reset}`);
            file1OnlyDiffs.forEach((diff, index) => {
                console.log(`${colors.yellow}  ${index + 1}. Sat ${diff.sat} → Block ${diff.file1Block}${colors.reset}`);
            });
            console.log();
        }

        // Display ALL entries only in file 2
        if (file2OnlyDiffs.length > 0) {
            console.log(`${colors.yellow}${colors.bright}🟡 ENTRIES ONLY IN FILE 2: ${file2OnlyDiffs.length} total${colors.reset}`);
            file2OnlyDiffs.forEach((diff, index) => {
                console.log(`${colors.yellow}  ${index + 1}. Sat ${diff.sat} → Block ${diff.file2Block}${colors.reset}`);
            });
            console.log();
        }
        */

        // Just show summary counts for file-only entries
        if (file1OnlyDiffs.length > 0) {
            console.log(`${colors.dim}ℹ️  ${file1OnlyDiffs.length} sats exist only in File 1 (likely new entries)${colors.reset}`);
        }
        
        if (file2OnlyDiffs.length > 0) {
            console.log(`${colors.dim}ℹ️  ${file2OnlyDiffs.length} sats exist only in File 2 (likely existing entries)${colors.reset}`);
        }
    }

    // Export differences to a detailed report file
    exportReport(outputPath = 'sat-comparison-report.json') {
        const report = {
            timestamp: new Date().toISOString(),
            summary: this.stats,
            differences: this.differences.map(diff => ({
                type: diff.type,
                sat: diff.sat,
                file1Block: diff.file1Block,
                file2Block: diff.file2Block,
                description: diff.description
            }))
        };

        try {
            fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
            console.log(`${colors.green}📄 Detailed report exported to: ${outputPath}${colors.reset}`);
        } catch (error) {
            console.error(`${colors.red}Error exporting report: ${error.message}${colors.reset}`);
        }
    }

    // Export only the differences as a CSV for easy analysis
    exportDifferencesCSV(outputPath = 'sat-differences.csv') {
        if (this.differences.length === 0) {
            console.log(`${colors.green}No differences to export to CSV.${colors.reset}`);
            return;
        }

        const csvLines = ['Type,Sat,File1_Block,File2_Block,Description'];
        
        this.differences.forEach(diff => {
            const file1Block = diff.file1Block || 'N/A';
            const file2Block = diff.file2Block || 'N/A';
            csvLines.push(`${diff.type},${diff.sat},${file1Block},${file2Block},"${diff.description}"`);
        });

        try {
            fs.writeFileSync(outputPath, csvLines.join('\n'));
            console.log(`${colors.green}📊 Differences exported to CSV: ${outputPath}${colors.reset}`);
        } catch (error) {
            console.error(`${colors.red}Error exporting CSV: ${error.message}${colors.reset}`);
        }
    }
}

// Main execution function
async function main() {
    const args = process.argv.slice(2);
    
    // Handle --help flag
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`${colors.cyan}${colors.bright}SAT COMPARATOR - Compare Bitcoin sat-to-block mapping files${colors.reset}`);
        console.log(`${colors.dim}Detects conflicts, validates data integrity, and identifies differences between JSON files.${colors.reset}\n`);
        
        console.log(`${colors.bright}USAGE:${colors.reset}`);
        console.log(`  node sat-comparator.mjs <file1.json> <file2.json> [options]\n`);
        
        console.log(`${colors.bright}OPTIONS:${colors.reset}`);
        console.log(`  ${colors.green}--help, -h${colors.reset}          Show this help message`);
        console.log(`  ${colors.green}--export-report${colors.reset}     Export detailed JSON report`);
        console.log(`  ${colors.green}--export-csv${colors.reset}        Export differences as CSV`);
        console.log(`  ${colors.green}--export-all${colors.reset}        Export both report and CSV\n`);
        
        console.log(`${colors.bright}EXAMPLES:${colors.reset}`);
        console.log(`  ${colors.yellow}# Basic comparison${colors.reset}`);
        console.log(`  node sat-comparator.mjs file1.json file2.json\n`);
        console.log(`  ${colors.yellow}# Compare with GitHub file${colors.reset}`);
        console.log(`  node sat-comparator.mjs my-list.json "C:\\path\\to\\github-file.json"\n`);
        console.log(`  ${colors.yellow}# Compare local file with GitHub URL${colors.reset}`);
        console.log(`  node sat-comparator.mjs file1.json "https://raw.githubusercontent.com/user/repo/main/file.json"\n`);
        
        console.log(`${colors.bright}WHAT IT FINDS:${colors.reset}`);
        console.log(`  ${colors.red}🚨 Block Conflicts${colors.reset}  - Same block, different sats (critical!)`);
        console.log(`  ${colors.red}🔴 Sat Conflicts${colors.reset}    - Same sat, different blocks`);
        console.log(`  ${colors.dim}ℹ️  File-only entries${colors.reset} - Sats that exist in only one file\n`);
        
        console.log(`${colors.dim}Supports both "block" and "blockheight" property names automatically.${colors.reset}`);
        process.exit(0);
    }
    
    if (args.length < 2) {
        console.log(`${colors.red}Usage: node sat-comparator.mjs <file1.json> <file2.json> [options]${colors.reset}`);
        console.log(`${colors.cyan}Use --help for detailed usage information${colors.reset}`);
        process.exit(1);
    }

    const file1Path = args[0];
    const file2Path = args[1];
    const exportReport = args.includes('--export-report') || args.includes('--export-all');
    const exportCSV = args.includes('--export-csv') || args.includes('--export-all');

    // Verify files exist (skip check for URLs)
    if (!file1Path.startsWith('http://') && !file1Path.startsWith('https://')) {
        if (!fs.existsSync(file1Path)) {
            console.error(`${colors.red}Error: File 1 not found: ${file1Path}${colors.reset}`);
            process.exit(1);
        }
    }

    if (!file2Path.startsWith('http://') && !file2Path.startsWith('https://')) {
        if (!fs.existsSync(file2Path)) {
            console.error(`${colors.red}Error: File 2 not found: ${file2Path}${colors.reset}`);
            process.exit(1);
        }
    }

    try {
        const comparator = new SatComparator();
        
        // Run the comparison
        await comparator.compareFiles(file1Path, file2Path);
        
        // Display results
        comparator.displayResults();
        
        // Export reports if requested
        if (exportReport) {
            comparator.exportReport();
        }
        
        if (exportCSV) {
            comparator.exportDifferencesCSV();
        }

        // Exit with appropriate code
        if (comparator.differences.length > 0) {
            console.log(`\n${colors.yellow}⚠️  Exiting with code 1 due to differences found.${colors.reset}`);
            process.exit(1);
        } else {
            console.log(`\n${colors.green}✅ Exiting with code 0 - files are identical.${colors.reset}`);
            process.exit(0);
        }

    } catch (error) {
        console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
        process.exit(1);
    }
}

// Run the script if called directly
main().catch(error => {
    console.error(`${colors.red}Unexpected error: ${error.message}${colors.reset}`);
    process.exit(1);
});

export { SatComparator };

