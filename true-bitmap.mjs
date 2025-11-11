#!/usr/bin/env node

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { RegistryComparator } from './validator.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

class TrueBitmapResolver {
    constructor() {
        this.blockstreamBase = 'https://blockstream.info/api';
        this.blockCache = new Map();
        this.rateLimitDelay = 50; // 50ms between API calls
    }

    // Fetch JSON from URL with retry logic
    async fetchJSON(url, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await new Promise((resolve, reject) => {
                    https.get(url, {
                        headers: { 'User-Agent': 'True-Bitmap-Resolver/1.0' }
                    }, (res) => {
                        let data = '';

                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            return this.fetchJSON(res.headers.location, retries).then(resolve).catch(reject);
                        }

                        if (res.statusCode !== 200) {
                            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                            return;
                        }

                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            try {
                                resolve(JSON.parse(data));
                            } catch (e) {
                                reject(new Error(`JSON parse error: ${e.message}`));
                            }
                        });
                    }).on('error', reject);
                });
            } catch (error) {
                if (attempt === retries) throw error;
                console.warn(`${colors.yellow}  Retry ${attempt}/${retries}: ${error.message}${colors.reset}`);
                await this.sleep(this.rateLimitDelay * attempt);
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Extract txid from inscription ID (format: <txid>i<index>)
    extractTxId(inscriptionId) {
        if (!inscriptionId || inscriptionId === 'ID not found') return null;
        const match = inscriptionId.match(/^([a-f0-9]{64})i\d+$/);
        return match ? match[1] : null;
    }

        // Fetch plain text from URL (for block hash endpoint)
    async fetchText(url, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await new Promise((resolve, reject) => {
                    https.get(url, {
                        headers: { 'User-Agent': 'True-Bitmap-Resolver/1.0' }
                    }, (res) => {
                        let data = '';

                        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                            return this.fetchText(res.headers.location, retries).then(resolve).catch(reject);
                        }

                        if (res.statusCode !== 200) {
                            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                            return;
                        }

                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve(data.trim()));  // Return plain text
                    }).on('error', reject);
                });
            } catch (error) {
                if (attempt === retries) throw error;
                console.warn(`${colors.yellow}  Retry ${attempt}/${retries}: ${error.message}${colors.reset}`);
                await this.sleep(this.rateLimitDelay * attempt);
            }
        }
    }

    // Get transaction position in block - CORRECTED VERSION
    async getTxPositionInBlock(txid) {
        try {
            console.log(`${colors.dim}  Fetching tx data for ${txid.substring(0, 16)}...${colors.reset}`);
            await this.sleep(this.rateLimitDelay);
            
            // Get full transaction data (includes block height and hash)
            const txUrl = `${this.blockstreamBase}/tx/${txid}`;
            const txData = await this.fetchJSON(txUrl);
            
            if (!txData || !txData.status) {
                console.warn(`${colors.yellow}  Warning: No status in tx data for ${txid}${colors.reset}`);
                return { blockHeight: null, blockPosition: null };
            }

            const blockHeight = txData.status.block_height;
            const blockHash = txData.status.block_hash;
            
            if (!blockHeight || !blockHash) {
                console.warn(`${colors.yellow}  Warning: Unconfirmed transaction ${txid}${colors.reset}`);
                return { blockHeight: null, blockPosition: null };
            }

            console.log(`${colors.dim}  Inscription in Bitcoin block ${blockHeight}${colors.reset}`);

            // Check cache for this block's transaction list
            const cacheKey = `${blockHeight}`;
            let txList;
            
            if (this.blockCache.has(cacheKey)) {
                txList = this.blockCache.get(cacheKey);
            } else {
                // Fetch transaction ordering for this block
                await this.sleep(this.rateLimitDelay);
                const blockUrl = `${this.blockstreamBase}/block/${blockHash}/txids`;
                txList = await this.fetchJSON(blockUrl);
                
                if (!Array.isArray(txList) || txList.length === 0) {
                    throw new Error(`Invalid txids response for block ${blockHash}`);
                }
                
                this.blockCache.set(cacheKey, txList);
                console.log(`${colors.dim}  Cached ${txList.length} transactions for block ${blockHeight}${colors.reset}`);
            }

            const position = txList.indexOf(txid);
            
            if (position === -1) {
                console.warn(`${colors.yellow}  Warning: txid not found in block ${blockHeight}${colors.reset}`);
                return { blockHeight, blockPosition: null };
            }

            console.log(`${colors.green}  Found at position ${position} in block ${blockHeight}${colors.reset}`);

            return { blockHeight, blockPosition: position };

        } catch (error) {
            console.error(`${colors.red}  Error fetching tx data: ${error.message}${colors.reset}`);
            return { blockHeight: null, blockPosition: null };
        }
    }

    // Resolve conflict using FiF rules
    async resolveConflict(conflict) {
        const { block, repo1Id, repo2Id, file1Sat, file2Sat } = conflict;

        // Case 1: Same inscription ID
        if (repo1Id === repo2Id) {
            return await this.resolveIdenticalInscriptionConflict(conflict);
        }

        // Case 2: One or both not found
        if (repo1Id === 'ID not found' && repo2Id === 'ID not found') {
            return { block, winner: 'NEITHER', inscriptionId: null, reason: 'Both IDs not found' };
        }
        if (repo1Id === 'ID not found') {
            return { block, winner: 'REPO2', inscriptionId: repo2Id, reason: 'Repo1 ID not found' };
        }
        if (repo2Id === 'ID not found') {
            return { block, winner: 'REPO1', inscriptionId: repo1Id, reason: 'Repo2 ID not found' };
        }

        // Case 3: Different IDs - determine which inscription was made first
        const txid1 = this.extractTxId(repo1Id);
        const txid2 = this.extractTxId(repo2Id);

        if (!txid1 || !txid2) {
            return { block, winner: 'UNKNOWN', inscriptionId: null, reason: 'Invalid inscription format' };
        }

        console.log(`${colors.cyan}Resolving bitmap ${block}.bitmap competition...${colors.reset}`);
        
        // Get transaction data for BOTH inscriptions
        const tx1Data = await this.getTxPositionInBlock(txid1);
        const tx2Data = await this.getTxPositionInBlock(txid2);

        // STEP 1: Compare inscription block heights (earlier block wins)
        if (tx1Data.blockHeight !== null && tx2Data.blockHeight !== null) {
            if (tx1Data.blockHeight < tx2Data.blockHeight) {
                return {
                    block,
                    winner: 'REPO1',
                    inscriptionId: repo1Id,
                    winningSat: file1Sat,
                    losingSat: file2Sat,
                    reason: `Inscribed in block ${tx1Data.blockHeight} (before block ${tx2Data.blockHeight})`
                };
            } else if (tx2Data.blockHeight < tx1Data.blockHeight) {
                return {
                    block,
                    winner: 'REPO2',
                    inscriptionId: repo2Id,
                    winningSat: file2Sat,
                    losingSat: file1Sat,
                    reason: `Inscribed in block ${tx2Data.blockHeight} (before block ${tx1Data.blockHeight})`
                };
            }
            
            // STEP 2: Same block - use transaction ordering
            console.log(`${colors.yellow}  Both inscriptions in block ${tx1Data.blockHeight}, checking tx order...${colors.reset}`);
            
            if (tx1Data.blockPosition !== null && tx2Data.blockPosition !== null) {
                if (tx1Data.blockPosition < tx2Data.blockPosition) {
                    return {
                        block,
                        winner: 'REPO1',
                        inscriptionId: repo1Id,
                        winningSat: file1Sat,
                        losingSat: file2Sat,
                        reason: `Same block ${tx1Data.blockHeight}, tx position ${tx1Data.blockPosition} before ${tx2Data.blockPosition}`
                    };
                } else if (tx2Data.blockPosition < tx1Data.blockPosition) {
                    return {
                        block,
                        winner: 'REPO2',
                        inscriptionId: repo2Id,
                        winningSat: file2Sat,
                        losingSat: file1Sat,
                        reason: `Same block ${tx2Data.blockHeight}, tx position ${tx2Data.blockPosition} before ${tx1Data.blockPosition}`
                    };
                }
            }
        }

        // Handle cases where data is missing
        // ADD SAT DATA
        if (tx1Data.blockHeight === null && tx2Data.blockHeight !== null) {
            return {
                block,
                winner: 'REPO2',
                inscriptionId: repo2Id,
                winningSat: file2Sat,
                losingSat: file1Sat,
                reason: 'Repo1 tx not confirmed'
            };
        }
        if (tx2Data.blockHeight === null && tx1Data.blockHeight !== null) {
            return {
                block,
                winner: 'REPO1',
                inscriptionId: repo1Id,
                winningSat: file1Sat,
                losingSat: file2Sat,
                reason: 'Repo2 tx not confirmed'
            };
        }

        return { block, winner: 'UNKNOWN', inscriptionId: null, reason: 'Could not determine winner' };
    }

    // Complete resolution for same inscription ID conflicts
    async resolveIdenticalInscriptionConflict(conflict) {
        const { block, repo1Id, repo2Id, file1Sat, file2Sat } = conflict;
        
        console.log(`${colors.yellow}Same inscription ID for bitmap ${block}, running full validation...${colors.reset}`);
        
        try {
            // STEP 1: Get actual satoshi for the agreed-upon inscription
            console.log(`${colors.cyan}STEP 1: Getting actual satoshi for ${repo1Id.substring(0, 16)}...${colors.reset}`);
            const actualSat = await this.getInscriptionSatoshi(repo1Id);
            
            if (!actualSat) {
                return { 
                    block, 
                    winner: 'UNKNOWN', 
                    inscriptionId: repo1Id, 
                    reason: 'Could not determine actual satoshi' 
                };
            }
            
            console.log(`${colors.green}  Inscription on sat ${actualSat}${colors.reset}`);
            
            // STEP 2: Compare actual sat to repo claims
            console.log(`${colors.cyan}STEP 2: Comparing sat claims${colors.reset}`);
            console.log(`${colors.dim}  Repo1 claims: ${file1Sat}${colors.reset}`);
            console.log(`${colors.dim}  Repo2 claims: ${file2Sat}${colors.reset}`);
            
            const actualSatStr = actualSat.toString();
            const repo1SatMatch = actualSatStr === file1Sat.toString();
            const repo2SatMatch = actualSatStr === file2Sat.toString();
            
            // STEP 3: Identify correct repo and remaining sat
            let correctRepo, correctInscriptionId, remainingSat;
            
            if (repo1SatMatch && !repo2SatMatch) {
                correctRepo = 'REPO1';
                correctInscriptionId = repo1Id;
                remainingSat = file2Sat;
            } else if (repo2SatMatch && !repo1SatMatch) {
                correctRepo = 'REPO2';
                correctInscriptionId = repo2Id;
                remainingSat = file1Sat;
            } else if (repo1SatMatch && repo2SatMatch) {
                // Both agree on sat - they're actually correct
                return {
                    block,
                    winner: 'BOTH',
                    inscriptionId: repo1Id,
                    reason: `Both agree: inscription on sat ${actualSat}`
                };
            } else {
                // Neither has correct sat
                return {
                    block,
                    winner: 'UNKNOWN',
                    inscriptionId: repo1Id,
                    reason: `Inscription on sat ${actualSat} (neither repo correct: ${file1Sat}/${file2Sat})`
                };
            }
            
            console.log(`${colors.green}STEP 3: ${correctRepo} has correct sat ${actualSat}${colors.reset}`);
            console.log(`${colors.yellow}  Remaining sat to validate: ${remainingSat}${colors.reset}`);
            
            // STEP 4: Find inscription ID for remaining sat
            console.log(`${colors.cyan}STEP 4: Finding inscription on remaining sat ${remainingSat}...${colors.reset}`);
            const remainingInscriptionId = await this.getInscriptionBySat(remainingSat, block);
            
            if (!remainingInscriptionId) {
                // Correct repo wins by default - other sat has no valid inscription
                return {
                    block,
                    winner: correctRepo,
                    inscriptionId: correctInscriptionId,
                    reason: `Correct sat ${actualSat}, remaining sat ${remainingSat} has no valid bitmap inscription`
                };
            }
            
            console.log(`${colors.green}  Found inscription ${remainingInscriptionId.substring(0, 16)}... on sat ${remainingSat}${colors.reset}`);
            
            // STEP 5: Convert both inscription IDs to txids
            console.log(`${colors.cyan}STEP 5: Extracting transaction IDs...${colors.reset}`);
            const correctTxid = this.extractTxId(correctInscriptionId);
            const remainingTxid = this.extractTxId(remainingInscriptionId);
            
            if (!correctTxid || !remainingTxid) {
                return {
                    block,
                    winner: correctRepo,
                    inscriptionId: correctInscriptionId,
                    reason: `Correct sat ${actualSat}, invalid remaining inscription format`
                };
            }
            
            // STEP 6: Get transaction ordering for both
            console.log(`${colors.cyan}STEP 6: Getting transaction ordering...${colors.reset}`);
            const correctTxData = await this.getTxPositionInBlock(correctTxid);
            const remainingTxData = await this.getTxPositionInBlock(remainingTxid);
            
            // STEP 7: Determine winner based on FiF rules
            console.log(`${colors.cyan}STEP 7: Applying First-is-First rules...${colors.reset}`);
            
            // Compare block heights first
            if (correctTxData.blockHeight !== null && remainingTxData.blockHeight !== null) {
                if (correctTxData.blockHeight < remainingTxData.blockHeight) {
                    return {
                        block,
                        winner: correctRepo,
                        inscriptionId: correctInscriptionId,
                        reason: `Correct sat ${actualSat}, inscribed in block ${correctTxData.blockHeight} (before ${remainingTxData.blockHeight})`
                    };
                } else if (remainingTxData.blockHeight < correctTxData.blockHeight) {
                    return {
                        block,
                        winner: correctRepo === 'REPO1' ? 'REPO2' : 'REPO1',
                        inscriptionId: remainingInscriptionId,
                        reason: `Wrong sat claim, but inscribed earlier (block ${remainingTxData.blockHeight} before ${correctTxData.blockHeight})`
                    };
                }
                
                // Same block - compare tx positions
                if (correctTxData.blockPosition !== null && remainingTxData.blockPosition !== null) {
                    if (correctTxData.blockPosition < remainingTxData.blockPosition) {
                        return {
                            block,
                            winner: correctRepo,
                            inscriptionId: correctInscriptionId,
                            reason: `Correct sat ${actualSat}, same block ${correctTxData.blockHeight}, tx position ${correctTxData.blockPosition} before ${remainingTxData.blockPosition}`
                        };
                    } else if (remainingTxData.blockPosition < correctTxData.blockPosition) {
                        return {
                            block,
                            winner: correctRepo === 'REPO1' ? 'REPO2' : 'REPO1',
                            inscriptionId: remainingInscriptionId,
                            reason: `Wrong sat claim, but tx position ${remainingTxData.blockPosition} before ${correctTxData.blockPosition} in block ${remainingTxData.blockHeight}`
                        };
                    }
                }
            }
            
            // Fallback - correct sat wins
            return {
                block,
                winner: correctRepo,
                inscriptionId: correctInscriptionId,
                reason: `Correct sat ${actualSat}, could not determine remaining inscription timing`
            };
            
        } catch (error) {
            console.error(`${colors.red}Error in full validation: ${error.message}${colors.reset}`);
            return { 
                block, 
                winner: 'UNKNOWN', 
                inscriptionId: repo1Id, 
                reason: `Validation failed: ${error.message}` 
            };
        }
    }

    // Find inscription ID for a given satoshi claiming a specific bitmap
    async getInscriptionBySat(satNumber, bitmapBlock) {
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`${colors.dim}  Searching for inscription on sat ${satNumber}...${colors.reset}`);
                await this.sleep(this.rateLimitDelay);
                
                // Use ordinals.com JSON API endpoint for sat data
                const satUrl = `https://ordinals.com/r/sat/${satNumber}`;
                const response = await this.fetchJSON(satUrl);
                
                // Response format: { ids: ["inscription_id1", "inscription_id2", ...] }
                if (!response || !response.ids || response.ids.length === 0) {
                    console.log(`${colors.dim}  No inscriptions found on sat ${satNumber}${colors.reset}`);
                    return null;
                }
                
                // Look for inscription with matching bitmap content
                for (const inscriptionId of response.ids) {
                    await this.sleep(this.rateLimitDelay);
                    
                    try {
                        // Get inscription content
                        const contentUrl = `https://ordinals.com/content/${inscriptionId}`;
                        const content = await this.fetchText(contentUrl);
                        const expectedContent = `${bitmapBlock}.bitmap`;
                        
                        if (content.trim() === expectedContent) {
                            console.log(`${colors.green}  Found matching bitmap inscription ${inscriptionId.substring(0, 16)}...${colors.reset}`);
                            return inscriptionId;
                        }
                    } catch (contentError) {
                        console.warn(`${colors.yellow}  Could not fetch content for ${inscriptionId}: ${contentError.message}${colors.reset}`);
                        continue;
                    }
                }
                
                console.log(`${colors.dim}  No matching bitmap inscription found on sat ${satNumber}${colors.reset}`);
                return null;
                
            } catch (error) {
                if (attempt === maxRetries) {
                    console.error(`${colors.red}  Failed to search sat ${satNumber}: ${error.message}${colors.reset}`);
                    return null;
                }
                console.warn(`${colors.yellow}  Retry ${attempt}/${maxRetries}: ${error.message}${colors.reset}`);
                await this.sleep(this.rateLimitDelay * attempt);
            }
        }
        
        return null;
    }

    // Get the satoshi number that an inscription is on
    async getInscriptionSatoshi(inscriptionId) {
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`${colors.dim}  Fetching satoshi for inscription ${inscriptionId.substring(0, 16)}...${colors.reset}`);
                await this.sleep(this.rateLimitDelay);
                
                // Use ordinals.com inscription endpoint
                const inscriptionUrl = `https://ordinals.com/inscription/${inscriptionId}`;
                
                // Fetch HTML page (ordinals.com doesn't have a JSON API for this)
                const htmlContent = await this.fetchText(inscriptionUrl);
                
                // Parse sat number from HTML
                // Look for pattern: <dt>sat</dt><dd><a href="/sat/1234567890">1234567890</a></dd>
                const satMatch = htmlContent.match(/<dt>sat<\/dt>\s*<dd>(?:<a[^>]*>)?(\d+)(?:<\/a>)?<\/dd>/i);
                
                if (!satMatch) {
                    console.warn(`${colors.yellow}  Could not find sat number in inscription page${colors.reset}`);
                    return null;
                }
                
                const satNumber = satMatch[1];
                console.log(`${colors.green}  Found sat: ${satNumber}${colors.reset}`);
                return satNumber;
                
            } catch (error) {
                if (attempt === maxRetries) {
                    console.error(`${colors.red}  Failed to get satoshi for ${inscriptionId}: ${error.message}${colors.reset}`);
                    return null;
                }
                console.warn(`${colors.yellow}  Retry ${attempt}/${maxRetries}: ${error.message}${colors.reset}`);
                await this.sleep(this.rateLimitDelay * attempt);
            }
        }
        
        return null;
    }

    // Generate final report
    generateReport(results) {
        const timestamp = new Date();
        const dateStr = timestamp.toISOString().replace(/[:.]/g, '-').split('T')[0];
        const timeStr = timestamp.toTimeString().split(' ')[0].replace(/:/g, '-');
        const reportFilename = `true-bitmaps-${dateStr}_${timeStr}.txt`;

        let report = '';
        report += '═'.repeat(80) + '\n';
        report += '    TRUE BITMAP WINNERS - FIRST-IS-FIRST RESOLUTION\n';
        report += '═'.repeat(80) + '\n\n';
        report += `Generated: ${timestamp.toISOString()}\n`;
        report += `Total Conflicts Resolved: ${results.length}\n\n`;

        const stats = {
            repo1: results.filter(r => r.winner === 'REPO1').length,
            repo2: results.filter(r => r.winner === 'REPO2').length,
            both: results.filter(r => r.winner === 'BOTH').length,
            neither: results.filter(r => r.winner === 'NEITHER').length,
            unknown: results.filter(r => r.winner === 'UNKNOWN').length
        };

        report += '─'.repeat(80) + '\n';
        report += '  SUMMARY\n';
        report += '─'.repeat(80) + '\n';
        report += `Repo1 Wins: ${stats.repo1}\n`;
        report += `Repo2 Wins: ${stats.repo2}\n`;
        report += `Both Match: ${stats.both}\n`;
        report += `Neither Found: ${stats.neither}\n`;
        report += `Unknown: ${stats.unknown}\n\n`;

        // NEW SECTION: Grouped blocks by winner in 4 columns
        report += '─'.repeat(80) + '\n';
        report += '  BLOCKS BY WINNER (4 COLUMNS)\n';
        report += '─'.repeat(80) + '\n\n';

        const winnerCategories = [
            { label: 'REPO1 WINS', winner: 'REPO1' },
            { label: 'REPO2 WINS', winner: 'REPO2' },
            { label: 'BOTH MATCH', winner: 'BOTH' },
            { label: 'NEITHER/UNKNOWN', winner: ['NEITHER', 'UNKNOWN'] }
        ];

        winnerCategories.forEach(category => {
            // Filter blocks for this category
            let blocks;
            if (Array.isArray(category.winner)) {
                blocks = results
                    .filter(r => category.winner.includes(r.winner))
                    .map(r => r.block)
                    .sort((a, b) => a - b);
            } else {
                blocks = results
                    .filter(r => r.winner === category.winner)
                    .map(r => r.block)
                    .sort((a, b) => a - b);
            }

            if (blocks.length === 0) {
                report += `${category.label}: None\n\n`;
                return;
            }

            report += `${category.label} (${blocks.length} blocks):\n`;

            // Format into 4 columns
            const columns = 4;
            const colWidth = 18; // Width per column (e.g., "123456  ")
            const rows = Math.ceil(blocks.length / columns);

            for (let row = 0; row < rows; row++) {
                let line = '  ';
                for (let col = 0; col < columns; col++) {
                    const index = row + (col * rows);
                    if (index < blocks.length) {
                        const blockStr = blocks[index].toString().padEnd(colWidth, ' ');
                        line += blockStr;
                    }
                }
                report += line.trimEnd() + '\n';
            }
            report += '\n';
        });

        report += '─'.repeat(80) + '\n';
        report += '  WINNERS BY BLOCK HEIGHT\n';
        report += '─'.repeat(80) + '\n\n';

        results.forEach((result, index) => {
            report += `${(index + 1).toString().padStart(3, ' ')}. Block ${result.block}:\n`;
            report += `     Winner: ${result.winner}\n`;
            if (result.inscriptionId) {
                report += `     ID: ${result.inscriptionId}\n`;
            }
            // Add sat information if available
            if (result.winningSat && result.losingSat) {
                report += `     Sats: ${result.winningSat} (winner) > ${result.losingSat} (loser)\n`;
            }
            report += `     Reason: ${result.reason}\n\n`;
        });

        report += '═'.repeat(80) + '\n';
        report += `Report: True Bitmap Resolver\n`;
        report += `Timestamp: ${timestamp.toISOString()}\n`;
        report += '═'.repeat(80) + '\n';

        return { report, filename: reportFilename };
    }

    // Main pipeline
    async run() {
        console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════════════${colors.reset}`);
        console.log(`${colors.bright}${colors.cyan}    TRUE BITMAP RESOLVER - FIRST-IS-FIRST${colors.reset}`);
        console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════════════${colors.reset}\n`);

        try {
            // Step 1: Run validator to get conflicts
            console.log(`${colors.bright}Step 1: Running registry validator...${colors.reset}`);

            // Check if --log flag is present in command line args
            const args = process.argv.slice(2);
            const enableValidatorOutput = args.includes('--log');

            // Pass suppressFileOutput option to validator (inverse of --log flag)
            const comparator = new RegistryComparator({ 
                suppressFileOutput: !enableValidatorOutput 
            });

            if (!enableValidatorOutput) {
                console.log(`${colors.dim}  (Validator file output suppressed - use --log flag to enable)${colors.reset}`);
            }

            const validatorResult = await comparator.run();
            
            const conflicts = validatorResult.conflicts || [];
            console.log(`${colors.green}✓ Found ${conflicts.length} block conflicts${colors.reset}\n`);

            if (conflicts.length === 0) {
                console.log(`${colors.green}No conflicts to resolve!${colors.reset}`);
                return;
            }

            // Step 2: Resolve each conflict
            console.log(`${colors.bright}Step 2: Resolving conflicts via Blockstream API...${colors.reset}`);
            const results = [];
            
            for (let i = 0; i < conflicts.length; i++) {
                const progress = `[${i + 1}/${conflicts.length}]`;
                console.log(`${colors.dim}${progress} Block ${conflicts[i].block}...${colors.reset}`);
                
                const result = await this.resolveConflict(conflicts[i]);
                results.push(result);

                if ((i + 1) % 10 === 0) {
                    console.log(`${colors.green}  ✓ Processed ${i + 1}/${conflicts.length}${colors.reset}`);
                }
            }
            console.log(`${colors.green}✓ All conflicts resolved${colors.reset}\n`);

            // Step 3: Generate report
            console.log(`${colors.bright}Step 3: Generating report...${colors.reset}`);
            const { report, filename } = this.generateReport(results);
            
            const outputPath = path.join(__dirname, filename);
            fs.writeFileSync(outputPath, report, 'utf8');

            console.log(`\n${colors.green}${colors.bright}✅ COMPLETE${colors.reset}`);
            console.log(`${colors.green}📄 Report: ${filename}${colors.reset}`);
            console.log(`${colors.dim}   Path: ${outputPath}${colors.reset}\n`);

            // Stats
            const stats = {
                repo1: results.filter(r => r.winner === 'REPO1').length,
                repo2: results.filter(r => r.winner === 'REPO2').length
            };
            console.log(`${colors.cyan}📊 Final: Repo1=${stats.repo1}, Repo2=${stats.repo2}${colors.reset}\n`);

        } catch (error) {
            console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
            console.error(error.stack);
            process.exit(1);
        }
    }
}

// Main entry
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`${colors.cyan}${colors.bright}TRUE BITMAP RESOLVER${colors.reset}`);
        console.log(`${colors.dim}In-memory FiF conflict resolution pipeline${colors.reset}\n`);
        console.log(`${colors.bright}USAGE:${colors.reset}`);
        console.log(`  node true-bitmap.mjs\n`);
        console.log(`${colors.bright}OPTIONS:${colors.reset}`);
        console.log(`  --log    Enable validator.mjs file output (default: suppressed)\n`);
        console.log(`${colors.bright}WHAT IT DOES:${colors.reset}`);
        console.log(`  1. Runs validator.mjs to detect conflicts`);
        console.log(`  2. Resolves conflicts using Blockstream API`);
        console.log(`  3. Applies First-is-First rules`);
        console.log(`  4. Generates winner report\n`);
        console.log(`${colors.bright}OUTPUT:${colors.reset}`);
        console.log(`  true-bitmaps-YYYY-MM-DD_HH-MM-SS.txt\n`);
        console.log(`  sat-comparison-YYYY-MM-DD_HH-MM-SS.txt (only with --log)\n`);
        console.log(`${colors.bright}CONFIGURE:${colors.reset}`);
        console.log(`  Edit repo URLs in validator.mjs constructor\n`);
        process.exit(0);
    }

    const resolver = new TrueBitmapResolver();
    await resolver.run();
}

main().catch(error => {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
});
