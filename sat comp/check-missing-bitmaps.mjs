#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help')) {
    console.log(`
📊 Bitmap Registry Gap Checker

Usage:
  node check-missing-bitmaps.mjs <file_path>
  node check-missing-bitmaps.mjs ./Registry/850000-859999.json

Options:
  --help              Show this help
  --threshold <N>     Set checking interval (default: 10000)
  --verbose           Show all checked blocks

Example:
  node check-missing-bitmaps.mjs ./Registry/850000-859999.json
  node check-missing-bitmaps.mjs ./Registry/920000-929999.json --verbose
    `);
    process.exit(0);
}

const filePath = args[0];
const verboseMode = args.includes('--verbose');
const thresholdArg = args.find((_, i) => args[i] === '--threshold');
const threshold = thresholdArg ? parseInt(args[args.indexOf(thresholdArg) + 1]) : 10000;

if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
}

try {
    const content = fs.readFileSync(filePath, 'utf8');
    const entries = JSON.parse(content);

    if (!Array.isArray(entries)) {
        console.error('❌ File does not contain a JSON array');
        process.exit(1);
    }

    // Extract file range from filename (e.g., "850000-859999" from "850000-859999.json")
    const fileName = path.basename(filePath, '.json');
    const [fileStart, fileEnd] = fileName.split('-').map(Number);

    if (isNaN(fileStart) || isNaN(fileEnd)) {
        console.error('❌ Could not parse file range from filename');
        process.exit(1);
    }

    // Create a Set of registered block heights
    const registeredBlocks = new Set(entries.map(e => e.block || e.blockHeight).filter(Boolean));

    console.log(`\n📋 Scanning ${fileName}.json (Range: ${fileStart}-${fileEnd})`);
    console.log(`📍 Total entries in file: ${entries.length}`);
    console.log(`🔍 Checking interval: every ${threshold.toLocaleString()} blocks\n`);

    const missing = [];
    let checked = 0;

    // Check EVERY block in the range
    for (let block = fileStart; block <= fileEnd; block++) {
        checked++;
        if (!registeredBlocks.has(block)) {
            missing.push(block);
        }
    }

    // Print summary of missing blocks
    if (missing.length > 0) {
        console.log(`❌ MISSING BLOCKS (${missing.length} total):\n`);
        
        // Group consecutive missing blocks
        const groups = [];
        let groupStart = missing[0];
        let groupEnd = missing[0];
        
        for (let i = 1; i < missing.length; i++) {
            if (missing[i] === groupEnd + 1) {
                groupEnd = missing[i];
            } else {
                groups.push({ start: groupStart, end: groupEnd });
                groupStart = missing[i];
                groupEnd = missing[i];
            }
        }
        groups.push({ start: groupStart, end: groupEnd });
        
        // Display grouped ranges
        for (const group of groups) {
            if (group.start === group.end) {
                console.log(`  • ${group.start}.bitmap`);
            } else {
                console.log(`  • ${group.start}.bitmap - ${group.end}.bitmap (${group.end - group.start + 1} blocks)`);
            }
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total blocks in file range: ${fileEnd - fileStart + 1}`);
    console.log(`Blocks registered: ${registeredBlocks.size}`);
    console.log(`Blocks MISSING: ${missing.length}`);

    if (missing.length > 0) {
        console.log(`\n🔴 Missing blocks (${missing.length} total):`);
        console.log(missing.join(', '));

        console.log(`\n📝 Command to reprocess:`);
        const startMissing = missing[0];
        const endMissing = missing[missing.length - 1];
        console.log(`  node bitmap3.mjs --start-height ${startMissing} --interval ${endMissing - startMissing + 1}`);
    } else {
        console.log(`\n✅ All ${checked} blocks present - no gaps found!`);
    }

    console.log(`\n`);

} catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
}