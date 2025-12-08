#!/usr/bin/env node

/* This script allows you to plug in any 2 .json file sources, mostly gtihub repos
and allows you to compare the "sat_n-n.json" files so that you can verify if the sat
numbers match their respective blocks/blockheights. It will output a list of blocks 
with different sats, vice versa, as well as sats not found in the other file. It uses
the sat-comparator.mjs script to run full repos, use the sat-comparator for individual
file comparison. Can be used with true-bitmap.mjs to determine the actual true state. */

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { SatComparator } from './sat-comparator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to determine which registry file contains a given block
function getRegistryFileForBlock(block) {
    // Validate block number
    if (block < 0 || block > 999999999) {
        return null;
    }
    
    // Determine range based on block number
    const rangeStart = Math.floor(block / 10000) * 10000;
    const rangeEnd = rangeStart + 9999;
    return `${rangeStart}-${rangeEnd}.json`;
}

// ANSI color codes
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

class RegistryComparator {
    constructor(options = {}) {
        this.repo1Base = 'https://raw.githubusercontent.com/YOUR_USER_NAME/bitmap-indexer/refs/heads/main/Registry/';
        this.repo2Base = 'file:///C:YOUR_FILE_DIRECTORY';
        this.repo1ListUrl = 'https://api.github.com/repos/YOUR_USER_NAME/bitmap-indexer/contents/Registry';
        this.repo2ListUrl = 'file:///C:YOUR_FILE_DIRECTORY';
        this.results = [];
        this.registryCache = new Map();
        this.suppressFileOutput = options.suppressFileOutput || false;
    }

    // Detect if a path is local or remote URL
    isLocalPath(pathOrUrl) {
        return !pathOrUrl.startsWith('http://') && !pathOrUrl.startsWith('https://');
    }

    // Fetch JSON from URL
    async fetchJSON(url) {
        return new Promise((resolve, reject) => {
            https.get(url, {
                headers: {
                    'User-Agent': 'Node.js Registry Validator'
                }
            }, (res) => {
                let data = '';

                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return this.fetchJSON(res.headers.location).then(resolve).catch(reject);
                }

                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage} for ${url}`));
                    return;
                }

                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
                    }
                });
            }).on('error', (error) => {
                reject(new Error(`Network error fetching ${url}: ${error.message}`));
            });
        });
    }

    // Get list of sat_*.json files from a GitHub repository or local directory
    async getRegistryFiles(repoListUrl, isLocal = false) {
        try {
            console.log(`${colors.cyan}Fetching file list from repository...${colors.reset}`);
            
            let satFiles = [];
            
            if (isLocal) {
                // Handle local file system
                const files = fs.readdirSync(repoListUrl);
                satFiles = files
                    .filter(name => name.startsWith('sat_') && name.endsWith('.json'))
                    .sort();
            } else {
                // Handle GitHub API
                const contents = await this.fetchJSON(repoListUrl);
                satFiles = contents
                    .filter(item => item.type === 'file' && item.name.startsWith('sat_') && item.name.endsWith('.json'))
                    .map(item => item.name)
                    .sort();
            }

            console.log(`${colors.green}✓ Found ${satFiles.length} sat_*.json files${colors.reset}`);
            return satFiles;
        } catch (error) {
            console.error(`${colors.red}Error fetching repository contents: ${error.message}${colors.reset}`);
            throw error;
        }
    }

    // Read JSON from local file or remote URL
    async readRegistryFile(filePath, isLocal = false) {
        if (isLocal) {
            try {
                const data = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(data);
            } catch (e) {
                throw new Error(`Failed to read local file ${filePath}: ${e.message}`);
            }
        } else {
            return this.fetchJSON(filePath);
        }
    }

    // Capture console output to string
    captureConsoleOutput(func) {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;
        let output = '';

        console.log = (...args) => {
            output += args.join(' ') + '\n';
            originalLog(...args);
        };
        console.error = (...args) => {
            output += args.join(' ') + '\n';
            originalError(...args);
        };
        console.warn = (...args) => {
            output += args.join(' ') + '\n';
            originalWarn(...args);
        };

        try {
            func();
        } finally {
            console.log = originalLog;
            console.error = originalError;
            console.warn = originalWarn;
        }

        return output;
    }

    // Compare a single file pair
    async compareFilePair(filename, index, total) {
        const file1Url = this.repo1Base + filename;
        const file2Url = this.repo2Base + filename;

        console.log(`\n${colors.bright}${colors.blue}[${ index + 1}/${total}] Comparing: ${filename}${colors.reset}`);
        console.log(`${colors.dim}  Repo 1: thebitmaptoshi/bitmap-indexer${colors.reset}`);
        console.log(`${colors.dim}  Repo 2: Zmakin/BNS${colors.reset}`);

        try {
            const comparator = new SatComparator({ blockConflictsOnly: true });
            
            // Capture the comparison output
            await comparator.compareFiles(file1Url, file2Url);

            // Build result summary
            const result = {
                filename: filename,
                timestamp: new Date().toISOString(),
                stats: { ...comparator.stats },
                hasDifferences: comparator.differences.length > 0,
                differences: comparator.differences
            };

            // Display inline results
            if (comparator.differences.length === 0) {
                console.log(`${colors.green}  ✓ No differences found${colors.reset}`);
            } else {
                console.log(`${colors.yellow}  ⚠ ${comparator.differences.length} differences found:${colors.reset}`);
                console.log(`${colors.red}    - Conflicts: ${comparator.stats.conflicts}${colors.reset}`);
                console.log(`${colors.yellow}    - File1 only: ${comparator.stats.file1Only}${colors.reset}`);
                console.log(`${colors.yellow}    - File2 only: ${comparator.stats.file2Only}${colors.reset}`);
                
                // Show block conflicts if any (most critical)
                const blockConflicts = comparator.differences.filter(d => d.type === 'BLOCK_CONFLICT');
                if (blockConflicts.length > 0) {
                    console.log(`${colors.red}    🚨 ${blockConflicts.length} CRITICAL block conflicts!${colors.reset}`);
                }
            }

            this.results.push(result);
            return result;

        } catch (error) {
            console.error(`${colors.red}  ✗ Error comparing ${filename}: ${error.message}${colors.reset}`);
            
            const errorResult = {
                filename: filename,
                timestamp: new Date().toISOString(),
                error: error.message,
                hasDifferences: false,
                differences: []
            };
            
            this.results.push(errorResult);
            return errorResult;
        }
    }

    // Fetch and cache a registry file
    async fetchRegistryFile(repoBase, filename, isLocal = false) {
        const cacheKey = `${repoBase}${filename}`;
        
        if (this.registryCache.has(cacheKey)) {
            return this.registryCache.get(cacheKey);
        }

        try {
            const url = `${repoBase}${filename}`;
            console.log(`${colors.dim}  Fetching registry: ${filename}${colors.reset}`);
            const data = await this.readRegistryFile(url, isLocal);
            this.registryCache.set(cacheKey, data);
            return data;
        } catch (error) {
            console.warn(`${colors.yellow}  Warning: Could not fetch ${filename}: ${error.message}${colors.reset}`);
            return [];
        }
    }

    // Look up inscription ID for a block from a specific repository
    async getInscriptionIdForBlock(block, repoBase, isLocal = false) {
        const registryFile = getRegistryFileForBlock(block);
        if (!registryFile) {
            return null;
        }

        const registryData = await this.fetchRegistryFile(repoBase, registryFile, isLocal);
        const entry = registryData.find(item => item.block === block);
        return entry ? entry.iD : null;
    }

    // Generate comprehensive text report
    async generateReport() {
        const timestamp = new Date();
        const dateStr = timestamp.toISOString().replace(/[:.]/g, '-').split('T')[0];
        const timeStr = timestamp.toTimeString().split(' ')[0].replace(/:/g, '-');
        const reportFilename = `sat-comparison-${dateStr}_${timeStr}.txt`;

        let report = '';
        report += '═'.repeat(80) + '\n';
        report += '    BITCOIN SAT REGISTRY VALIDATION REPORT\n';
        report += '═'.repeat(80) + '\n\n';
        report += `Generated: ${timestamp.toISOString()}\n`;
        report += `Repository 1: thebitmaptoshi/bitmap-indexer\n`;
        report += `Repository 2: Zmakin/BNS\n`;
        report += `Total Files Compared: ${this.results.length}\n\n`;

        // Collect ONLY block conflicts from all files
        const allBlockConflicts = [];
        const conflictMap = new Map();
        
        // Maps for inter-file conflict detection (blocks that appear in different files)
        const repo1BlockToSat = new Map();
        const repo2BlockToSat = new Map();

        this.results.forEach(result => {
            if (!result.differences) return;
            
            // Collect intra-file BLOCK_CONFLICT entries (same block, different sats in same file)
            result.differences.forEach(conflict => {
                if (conflict.type === 'BLOCK_CONFLICT') {
                    if (!conflictMap.has(conflict.block)) {
                        allBlockConflicts.push(conflict);
                        conflictMap.set(conflict.block, true);
                    }
                }
            });
            
            // Build repo-wide block maps from FILE1_ONLY and FILE2_ONLY entries
            // to detect inter-file conflicts (same block in different files with different sats)
            const file1OnlyEntries = result.differences.filter(d => d.type === 'FILE1_ONLY');
            const file2OnlyEntries = result.differences.filter(d => d.type === 'FILE2_ONLY');
            
            file1OnlyEntries.forEach(entry => {
                if (entry.file1Block && entry.sat) {
                    repo1BlockToSat.set(entry.file1Block, entry.sat);
                }
            });
            
            file2OnlyEntries.forEach(entry => {
                if (entry.file2Block && entry.sat) {
                    repo2BlockToSat.set(entry.file2Block, entry.sat);
                }
            });
        });
        
        // Check for inter-file conflicts: same block in both repos with different sats
        const allBlocksFromBothRepos = new Set([...repo1BlockToSat.keys(), ...repo2BlockToSat.keys()]);
        
        for (const block of allBlocksFromBothRepos) {
            const repo1Sat = repo1BlockToSat.get(block);
            const repo2Sat = repo2BlockToSat.get(block);
            
            if (repo1Sat && repo2Sat && repo1Sat !== repo2Sat) {
                // Inter-file conflict detected!
                if (!conflictMap.has(block)) {
                    allBlockConflicts.push({
                        type: 'BLOCK_CONFLICT',
                        block: block,
                        file1Sat: repo1Sat,
                        file2Sat: repo2Sat,
                        isInterFileConflict: true
                    });
                    conflictMap.set(block, true);
                }
            }
        }

        // Sort by block height (ascending)
        allBlockConflicts.sort((a, b) => a.block - b.block);
        this.allBlockConflicts = allBlockConflicts;

        // Overall statistics
        const filesWithDifferences = this.results.filter(r => r.hasDifferences).length;
        const filesWithErrors = this.results.filter(r => r.error).length;

        report += '─'.repeat(80) + '\n';
        report += '  OVERALL SUMMARY\n';
        report += '─'.repeat(80) + '\n';
        report += `Files compared: ${this.results.length}\n`;
        report += `Files with differences: ${filesWithDifferences}\n`;
        report += `Files with errors: ${filesWithErrors}\n`;
        report += `🚨 Total block conflicts (bitmap competition entries): ${allBlockConflicts.length}\n`;
        report += `   (Includes intra-file and inter-file conflicts)\n\n`;

        // Add combined block conflicts list sorted by block height with inscription IDs
        if (allBlockConflicts.length > 0) {
            report += '─'.repeat(80) + '\n';
            report += '  🚨 ALL BLOCK CONFLICTS (SORTED BY BLOCK HEIGHT)\n';
            report += '─'.repeat(80) + '\n';
            report += `Total: ${allBlockConflicts.length} block conflicts found across all files\n\n`;
            
            // Fetch inscription IDs for all conflicts with validation
            console.log(`\n${colors.cyan}Fetching inscription IDs for ${allBlockConflicts.length} conflicts...${colors.reset}`);
            const failedLookups = [];
            
            for (let i = 0; i < allBlockConflicts.length; i++) {
                const diff = allBlockConflicts[i];
                const progress = `[${i + 1}/${allBlockConflicts.length}]`;
                
                try {
                    // Fetch inscription IDs from both repos with validation
                    const repo1Id = await this.getInscriptionIdForBlock(diff.block, this.repo1Base, this.isLocalPath(this.repo1Base));
                    const repo2Id = await this.getInscriptionIdForBlock(diff.block, this.repo2Base, this.isLocalPath(this.repo2Base));
                    
                    // Validate that we got valid results (not null/undefined)
                    if (!repo1Id || !repo2Id) {
                        console.warn(`${colors.yellow}  ${progress} Block ${diff.block}: Incomplete ID lookup (repo1=${repo1Id ? 'found' : 'missing'}, repo2=${repo2Id ? 'found' : 'missing'})${colors.reset}`);
                        failedLookups.push({ block: diff.block, repo1Id: repo1Id || 'LOOKUP_FAILED', repo2Id: repo2Id || 'LOOKUP_FAILED' });
                    }
                    
                    // Store IDs in the diff object
                    diff.repo1Id = repo1Id || 'ID not found';
                    diff.repo2Id = repo2Id || 'ID not found';
                    
                    if ((i + 1) % 10 === 0) {
                        console.log(`${colors.dim}  ${progress} Fetched inscription IDs for block ${diff.block}${colors.reset}`);
                    }
                } catch (error) {
                    console.error(`${colors.red}  ${progress} Error fetching IDs for block ${diff.block}: ${error.message}${colors.reset}`);
                    failedLookups.push({ block: diff.block, error: error.message });
                    diff.repo1Id = 'LOOKUP_ERROR';
                    diff.repo2Id = 'LOOKUP_ERROR';
                }
            }
            console.log(`${colors.green}✓ Inscription ID lookup complete${colors.reset}`);
            
            if (failedLookups.length > 0) {
                console.warn(`${colors.yellow}⚠️  ${failedLookups.length} conflicts had incomplete ID lookups${colors.reset}`);
                failedLookups.forEach(item => {
                    console.warn(`${colors.dim}   Block ${item.block}: repo1=${item.repo1Id}, repo2=${item.repo2Id}${item.error ? `, error=${item.error}` : ''}${colors.reset}`);
                });
            }
            
            // Generate report with inscription IDs
            allBlockConflicts.forEach((diff, index) => {
                report += `  ${(index + 1).toString().padStart(3, ' ')}. Block ${diff.block}:\n`;
                report += `       Repo1→ID: ${diff.repo1Id}\n`;
                report += `       Repo2→ID: ${diff.repo2Id}\n`;
                report += `       (Sat conflict: ${diff.file1Sat} vs ${diff.file2Sat})\n`;
            });
            report += '\n';
        }

        // Critical issues section
        const criticalFiles = this.results.filter(r => {
            if (!r.differences) return false;
            return r.differences.some(d => d.type === 'BLOCK_CONFLICT' || d.type === 'CONFLICT');
        });

                if (criticalFiles.length > 0) {
            report += '─'.repeat(80) + '\n';
            report += '  🚨 CRITICAL ISSUES - FILES WITH CONFLICTS\n';
            report += '─'.repeat(80) + '\n';
            
            for (const result of criticalFiles) {  // ✅ Changed to for...of loop
                const blockConflicts = result.differences.filter(d => d.type === 'BLOCK_CONFLICT');
                const satConflicts = result.differences.filter(d => d.type === 'CONFLICT');

                report += `\n📁 ${result.filename}\n`;
                if (blockConflicts.length > 0) {
                    report += `  🚨 ${blockConflicts.length} Block conflicts (same block, different sats):\n`;
                    
                    // Fetch inscription IDs for these conflicts if not already fetched
                    for (const diff of blockConflicts) {
                        if (!diff.repo1Id) {
                            diff.repo1Id = await this.getInscriptionIdForBlock(diff.block, this.repo1Base) || 'ID not found';
                            diff.repo2Id = await this.getInscriptionIdForBlock(diff.block, this.repo2Base) || 'ID not found';
                        }
                        report += `     Block ${diff.block}:\n`;
                        report += `       Repo1→ID: ${diff.repo1Id}\n`;
                        report += `       Repo2→ID: ${diff.repo2Id}\n`;
                    }
                }
                // Uncomment the following section to show sat conflicts (same sat, different blocks):
                // if (satConflicts.length > 0) {
                //     report += `  🔴 ${satConflicts.length} Sat conflicts (same sat, different blocks):\n`;
                //     satConflicts.forEach(diff => {
                //         report += `     Sat ${diff.sat}: Repo1→Block ${diff.file1Block}, Repo2→Block ${diff.file2Block}\n`;
                //     });
                // }
            }
            report += '\n';
        }

        // Detailed results for each file
        report += '─'.repeat(80) + '\n';
        report += '  DETAILED FILE-BY-FILE RESULTS\n';
        report += '─'.repeat(80) + '\n\n';

        this.results.forEach((result, index) => {
            report += `[${index + 1}/${this.results.length}] ${result.filename}\n`;
            report += `${'─'.repeat(80)}\n`;

            if (result.error) {
                report += `❌ ERROR: ${result.error}\n\n`;
                return;
            }

            report += `Repo1 entries: ${result.stats.file1Count}\n`;
            report += `Repo2 entries: ${result.stats.file2Count}\n`;
            report += `Matches: ${result.stats.matches}\n`;
            report += `Conflicts: ${result.stats.conflicts}\n`;
            report += `Repo1 only: ${result.stats.file1Only}\n`;
            report += `Repo2 only: ${result.stats.file2Only}\n`;
            report += `Total differences: ${result.differences.length}\n\n`;

            if (result.differences.length > 0) {
                report += `DIFFERENCES:\n`;

                // Group by type
                const grouped = {
                    'BLOCK_CONFLICT': [],
                    'CONFLICT': [],
                    'FILE1_ONLY': [],
                    'FILE2_ONLY': []
                };

                result.differences.forEach(diff => {
                    grouped[diff.type]?.push(diff);
                });

                // Block conflicts
                if (grouped.BLOCK_CONFLICT.length > 0) {
                    report += `\n  🚨 Block Conflicts (${grouped.BLOCK_CONFLICT.length}):\n`;
                    grouped.BLOCK_CONFLICT.forEach(diff => {
                        report += `    - Block ${diff.block}: Repo1→Sat ${diff.file1Sat}, Repo2→Sat ${diff.file2Sat}\n`;
                    });
                }

                // Uncomment the following section to show sat conflicts (same sat, different blocks):
                // if (grouped.CONFLICT.length > 0) {
                //     report += `\n  🔴 Sat Conflicts (${grouped.CONFLICT.length}):\n`;
                //     grouped.CONFLICT.forEach(diff => {
                //         report += `    - Sat ${diff.sat}: Repo1→Block ${diff.file1Block}, Repo2→Block ${diff.file2Block}\n`;
                //     });
                // }

                // File1 only
                if (grouped.FILE1_ONLY.length > 0) {
                    report += `\n  📄 Entries only in Repo1 (${grouped.FILE1_ONLY.length}):\n`;
                    grouped.FILE1_ONLY.slice(0, 20).forEach(diff => {
                        report += `    - Sat ${diff.sat} → Block ${diff.file1Block}\n`;
                    });
                    if (grouped.FILE1_ONLY.length > 20) {
                        report += `    ... and ${grouped.FILE1_ONLY.length - 20} more\n`;
                    }
                }

                // File2 only
                if (grouped.FILE2_ONLY.length > 0) {
                    report += `\n  📄 Entries only in Repo2 (${grouped.FILE2_ONLY.length}):\n`;
                    grouped.FILE2_ONLY.slice(0, 20).forEach(diff => {
                        report += `    - Sat ${diff.sat} → Block ${diff.file2Block}\n`;
                    });
                    if (grouped.FILE2_ONLY.length > 20) {
                        report += `    ... and ${grouped.FILE2_ONLY.length - 20} more\n`;
                    }
                }
            } else {
                report += `✅ No differences found - files are identical\n`;
            }

            report += '\n';
        });

        // Footer
        report += '═'.repeat(80) + '\n';
        report += `Report generated by Bitcoin SAT Registry Validator\n`;
        report += `Timestamp: ${timestamp.toISOString()}\n`;
        report += '═'.repeat(80) + '\n';

        return { report, filename: reportFilename };
    }

    // Main execution
    async run() {
        console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════════════${colors.reset}`);
        console.log(`${colors.bright}${colors.cyan}    BITCOIN SAT REGISTRY VALIDATOR${colors.reset}`);
        console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════════════${colors.reset}\n`);

        try {
            // Get list of files from repository 1
            console.log(`${colors.bright}Step 1: Fetching file list from repositories...${colors.reset}`);
            const repo1Files = await this.getRegistryFiles(this.repo1ListUrl, this.isLocalPath(this.repo1ListUrl));
            const repo2Files = await this.getRegistryFiles(this.repo2ListUrl, this.isLocalPath(this.repo2ListUrl));

            // Verify both repos have the same files
            const filesInBoth = repo1Files.filter(f => repo2Files.includes(f));
            
            if (filesInBoth.length !== repo1Files.length) {
                console.warn(`${colors.yellow}Warning: Repos have different file sets${colors.reset}`);
                console.warn(`${colors.yellow}  Repo1: ${repo1Files.length} files, Repo2: ${repo2Files.length} files${colors.reset}`);
                console.warn(`${colors.yellow}  Comparing only files present in both: ${filesInBoth.length} files${colors.reset}\n`);
            }

            const filesToCompare = filesInBoth;
            console.log(`${colors.green}✓ Will compare ${filesToCompare.length} files\n${colors.reset}`);

            // Compare each file pair
            console.log(`${colors.bright}Step 2: Comparing files...${colors.reset}`);
            for (let i = 0; i < filesToCompare.length; i++) {
                await this.compareFilePair(filesToCompare[i], i, filesToCompare.length);
            }

            // Generate report (but conditionally save to file)
            console.log(`\n${colors.bright}Step 3: Generating report...${colors.reset}`);
            const { report, filename } = await this.generateReport();

            // Only write to file if not suppressed
            if (!this.suppressFileOutput) {
                const outputPath = path.join(__dirname, filename);
                fs.writeFileSync(outputPath, report, 'utf8');

                console.log(`\n${colors.green}${colors.bright}✅ VALIDATION COMPLETE${colors.reset}`);
                console.log(`${colors.green}📄 Report saved to: ${filename}${colors.reset}`);
                console.log(`${colors.dim}   Full path: ${outputPath}${colors.reset}\n`);
            } else {
                console.log(`\n${colors.green}${colors.bright}✅ VALIDATION COMPLETE${colors.reset}`);
                console.log(`${colors.dim}   Report file output suppressed (in-memory mode)${colors.reset}\n`);
            }

            // Summary (always show)
            const filesWithDiffs = this.results.filter(r => r.hasDifferences).length;
            if (filesWithDiffs > 0) {
                console.log(`${colors.yellow}⚠️  ${filesWithDiffs} file(s) had differences${colors.reset}`);
            } else {
                console.log(`${colors.green}🎉 All files are identical!${colors.reset}`);
            }

            // Return conflicts data for programmatic use (in-memory mode)
            return {
                conflicts: this.allBlockConflicts || [],
                stats: {
                    totalFiles: this.results.length,
                    filesWithDifferences: filesWithDiffs,
                    totalConflicts: this.allBlockConflicts?.length || 0
                }
            };

        } catch (error) {
            console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
            console.error(error.stack);
            process.exit(1);
        }
    }
}

// Main entry point
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`${colors.cyan}${colors.bright}BITCOIN SAT REGISTRY VALIDATOR${colors.reset}`);
        console.log(`${colors.dim}Validate all sat_*.json files between two GitHub registries${colors.reset}\n`);
        console.log(`${colors.bright}USAGE:${colors.reset}`);
        console.log(`  node validator.mjs\n`);
        console.log(`${colors.bright}WHAT IT DOES:${colors.reset}`);
        console.log(`  1. Fetches all sat_*.json files from both repositories`);
        console.log(`  2. Compares each file pair using sat-comparator.mjs`);
        console.log(`  3. Generates a comprehensive timestamped report\n`);
        console.log(`${colors.bright}REPOSITORIES:${colors.reset}`);
        console.log(`  Repo 1: thebitmaptoshi/bitmap-indexer/Registry/`);
        console.log(`  Repo 2: Zmakin/BNS/Registry/\n`);
        console.log(`${colors.bright}OUTPUT:${colors.reset}`);
        console.log(`  Creates: sat-comparison-YYYY-MM-DD_HH-MM-SS.txt`);
        console.log(`  Location: Same directory as this script\n`);
        process.exit(0);
    }

    const comparator = new RegistryComparator();
    await comparator.run();
}

// Run main if executed directly 
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error(`${colors.red}Unexpected error: ${error.message}${colors.reset}`);
        console.error(error.stack);
        process.exit(1);
    });
}

// Export class for module usage
export { RegistryComparator };
