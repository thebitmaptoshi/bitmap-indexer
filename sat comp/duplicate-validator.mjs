#!/usr/bin/env node

import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

const KNOWN_MISSING_BLOCKS = 3; // Update if you know which blocks are missing
const TOTAL_BLOCKS = 925655;

class DuplicateValidator {
    constructor(options = {}) {
        this.registryBase = options.registryBase || 'C:\\Users\\Your\\Local\\FilePath\\';  //make sure to change
        this.results = {
            duplicateBlocks: new Map(),
            duplicateSats: new Map(),
            totalEntries: 0,
            uniqueBlocks: new Set(),
            uniqueSats: new Set(),
            invalidEntries: []
        };
    }

    async readRegistryFile(filePath) {
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error(`${colors.red}Failed to read ${filePath}: ${e.message}${colors.reset}`);
            return [];
        }
    }

    async scanAllFiles() {
        console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════════════${colors.reset}`);
        console.log(`${colors.bright}${colors.cyan}    DUPLICATE BLOCK/SAT VALIDATOR${colors.reset}`);
        console.log(`${colors.bright}${colors.cyan}═══════════════════════════════════════════════════════════════════════${colors.reset}\n`);

        try {
            console.log(`${colors.cyan}Scanning registry files for duplicates...${colors.reset}\n`);
            
            const files = fs.readdirSync(this.registryBase)
                .filter(name => name.startsWith('sat_') && name.endsWith('.json'))
                .sort();

            console.log(`${colors.green}✓ Found ${files.length} registry files${colors.reset}\n`);

            for (let i = 0; i < files.length; i++) {
                const filename = files[i];
                const filePath = path.join(this.registryBase, filename);
                
                if ((i + 1) % 10 === 0 || i === 0) {
                    console.log(`${colors.dim}[${i + 1}/${files.length}] Processing ${filename}...${colors.reset}`);
                }

                const entries = await this.readRegistryFile(filePath);
                await this.validateEntries(entries, filename);
            }

            return this.generateReport();

        } catch (error) {
            console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
            throw error;
        }
    }

    async validateEntries(entries, filename) {
        for (const entry of entries) {
            this.results.totalEntries++;

            // Validate entry structure
            if (!entry.block || entry.block === undefined) {
                this.results.invalidEntries.push({
                    file: filename,
                    entry: entry,
                    reason: 'Missing block field'
                });
                continue;
            }

            if (!entry.sat && entry.sat !== 0) {
                this.results.invalidEntries.push({
                    file: filename,
                    entry: entry,
                    reason: 'Missing or invalid sat field'
                });
                continue;
            }

            const block = entry.block;
            const sat = entry.sat;

            // Track unique blocks
            if (!this.results.uniqueBlocks.has(block)) {
                this.results.uniqueBlocks.add(block);
            } else {
                // Duplicate block found
                if (!this.results.duplicateBlocks.has(block)) {
                    this.results.duplicateBlocks.set(block, []);
                }
                this.results.duplicateBlocks.get(block).push({
                    file: filename,
                    sat: sat,
                    entry: entry
                });
            }

            // Track unique sats
            if (!this.results.uniqueSats.has(sat)) {
                this.results.uniqueSats.add(sat);
            } else {
                // Duplicate sat found
                if (!this.results.duplicateSats.has(sat)) {
                    this.results.duplicateSats.set(sat, []);
                }
                this.results.duplicateSats.get(sat).push({
                    file: filename,
                    block: block,
                    entry: entry
                });
            }
        }
    }

    generateReport() {
        const timestamp = new Date();
        const dateStr = timestamp.toISOString().replace(/[:.]/g, '-').split('T')[0];
        const timeStr = timestamp.toTimeString().split(' ')[0].replace(/:/g, '-');
        const reportFilename = `duplicate-validation-${dateStr}_${timeStr}.txt`;

        let report = '';
        report += '═'.repeat(80) + '\n';
        report += '    DUPLICATE BLOCK/SAT VALIDATION REPORT\n';
        report += '═'.repeat(80) + '\n\n';
        report += `Generated: ${timestamp.toISOString()}\n`;
        report += `Registry Path: ${this.registryBase}\n\n`;

        // Summary
        report += '─'.repeat(80) + '\n';
        report += '  SUMMARY\n';
        report += '─'.repeat(80) + '\n';
        report += `Total entries scanned: ${this.results.totalEntries}\n`;
        report += `Expected entries: ${TOTAL_BLOCKS - KNOWN_MISSING_BLOCKS}\n`;
        report += `Excess entries: ${this.results.totalEntries - (TOTAL_BLOCKS - KNOWN_MISSING_BLOCKS)}\n`;
        report += `Unique blocks found: ${this.results.uniqueBlocks.size}\n`;
        report += `Unique sats found: ${this.results.uniqueSats.size}\n`;
        report += `Invalid entries: ${this.results.invalidEntries.length}\n`;
        report += `Duplicate blocks: ${this.results.duplicateBlocks.size}\n`;
        report += `Duplicate sats: ${this.results.duplicateSats.size}\n\n`;

        // Check for missing blocks
        const missingBlocks = [];
        for (let i = 0; i < TOTAL_BLOCKS; i++) {
            if (!this.results.uniqueBlocks.has(i)) {
                missingBlocks.push(i);
            }
        }
        report += `Missing blocks: ${missingBlocks.length}\n`;
        if (missingBlocks.length > 0) {
            report += `  Missing blocks list:\n`;
            missingBlocks.forEach(block => {
                report += `    - ${block}\n`;
            });
        }
        report += '\n';

        // Invalid entries - show all
        if (this.results.invalidEntries.length > 0) {
            report += '─'.repeat(80) + '\n';
            report += '  ⚠️  INVALID ENTRIES\n';
            report += '─'.repeat(80) + '\n';
            this.results.invalidEntries.forEach((item, idx) => {
                report += `${idx + 1}. File: ${item.file}\n`;
                report += `   Reason: ${item.reason}\n`;
                report += `   Entry: ${JSON.stringify(item.entry)}\n\n`;
            });
        }

        // Duplicate blocks - show all
        if (this.results.duplicateBlocks.size > 0) {
            report += '─'.repeat(80) + '\n';
            report += '  🚨 DUPLICATE BLOCKS (same block, multiple sats)\n';
            report += '─'.repeat(80) + '\n';
            report += `Total blocks with duplicates: ${this.results.duplicateBlocks.size}\n`;
            report += `Total duplicate instances: ${Array.from(this.results.duplicateBlocks.values()).reduce((sum, arr) => sum + arr.length, 0)}\n\n`;

            const sortedBlocks = Array.from(this.results.duplicateBlocks.entries())
                .sort((a, b) => a[0] - b[0]);

            sortedBlocks.forEach(([block, duplicates]) => {
                report += `Block ${block}:\n`;
                duplicates.forEach((dup, idx) => {
                    report += `  ${idx + 1}. File: ${dup.file}, Sat: ${dup.sat}\n`;
                });
            });
            report += '\n';
        }

        // Duplicate sats - show all
        if (this.results.duplicateSats.size > 0) {
            report += '─'.repeat(80) + '\n';
            report += '  🚨 DUPLICATE SATS (same sat, multiple blocks)\n';
            report += '─'.repeat(80) + '\n';
            report += `Total sats with duplicates: ${this.results.duplicateSats.size}\n`;
            report += `Total duplicate instances: ${Array.from(this.results.duplicateSats.values()).reduce((sum, arr) => sum + arr.length, 0)}\n\n`;

            const sortedSats = Array.from(this.results.duplicateSats.entries())
                .sort((a, b) => a[0] - b[0]);

            sortedSats.forEach(([sat, duplicates]) => {
                report += `Sat ${sat}:\n`;
                duplicates.forEach((dup, idx) => {
                    report += `  ${idx + 1}. File: ${dup.file}, Block: ${dup.block}\n`;
                });
            });
            report += '\n';
        }

        // Console output
        console.log(`\n${colors.green}${colors.bright}✅ VALIDATION COMPLETE${colors.reset}`);
        console.log(`\n${colors.bright}KEY FINDINGS:${colors.reset}`);
        console.log(`  Total entries: ${colors.cyan}${this.results.totalEntries}${colors.reset}`);
        console.log(`  Expected entries: ${colors.cyan}${TOTAL_BLOCKS - KNOWN_MISSING_BLOCKS}${colors.reset}`);
        console.log(`  Excess: ${colors.yellow}${this.results.totalEntries - (TOTAL_BLOCKS - KNOWN_MISSING_BLOCKS)}${colors.reset}`);
        console.log(`  Duplicate blocks: ${colors.red}${this.results.duplicateBlocks.size}${colors.reset}`);
        console.log(`  Duplicate sats: ${colors.red}${this.results.duplicateSats.size}${colors.reset}`);
        console.log(`  Invalid entries: ${colors.red}${this.results.invalidEntries.length}${colors.reset}\n`);

        // Write report
        const outputPath = path.join(__dirname, reportFilename);
        const reportSize = Buffer.byteLength(report, 'utf8');
        
        try {
            fs.writeFileSync(outputPath, report, 'utf8');
            console.log(`${colors.green}📄 Report saved: ${reportFilename}${colors.reset}`);
            console.log(`${colors.dim}   Size: ${(reportSize / 1024).toFixed(2)} KB${colors.reset}\n`);
        } catch (error) {
            console.error(`${colors.red}Failed to write report: ${error.message}${colors.reset}`);
        }

        return {
            duplicateBlocks: this.results.duplicateBlocks,
            duplicateSats: this.results.duplicateSats,
            invalidEntries: this.results.invalidEntries,
            missingBlocks: missingBlocks
        };
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    // Get registry path from CLI or use default
    const registryPath = args[0] || 'C:\\Users\\Your\\FilePath\\bns-output\\Registry\\';   // make sure to change
    
    const validator = new DuplicateValidator({
        registryBase: registryPath
    });

    const report = await validator.scanAllFiles();
    
    // Return the report filename for chaining
    return report;
}

main().catch(error => {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
    process.exit(1);
});