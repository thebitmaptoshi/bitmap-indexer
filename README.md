# Bitmap Indexer 🗺️

**Work in progress** - Index has finished running. OCI validation returned repeat matching diffs, validated on bitcoin for bitmap-indexer validation over OCI.
Need to further alidate the script can run w/o further refinement and catch all blocks. Will add script after further validation, but as of now this it a live
source of truth for the most current bitmaps.

A real-time Bitcoin bitmap inscription registry and monitoring tool that tracks, validates, and registers bitmap claims on the Bitcoin blockchain with comprehensive validation and conflict resolution utilities.

## Overview

The Bitmap Indexer scans Bitcoin blocks for bitmap inscriptions (format: `{number}.bitmap`), validates them according to first-is-first (FiF) rules, and maintains a comprehensive registry stored on GitHub. It provides both live monitoring and historical block analysis capabilities with automatic competition resolution for contested bitmap claims.

## Features

- **Real-time Bitmap Monitoring**: Connects to mempool.space WebSocket for instant new block notifications
- **Bitmap Validation**: Validates inscriptions with `{number}.bitmap` format and `text/plain` content type
- **First-is-First Competition**: Resolves bitmap conflicts using precise Bitcoin transaction ordering
- **GitHub Registry Integration**: Automatically maintains registry files on GitHub with atomic updates
- **Sat Lookup Registry**: Maintains reverse lookup tables for sat number to block mapping
- **Multiple Operation Modes**: Single block analysis, range monitoring, continuous live tracking, or read-only exploration
- **Sequential Run Optimization**: Uses local caching for continuous monitoring efficiency
- **Enhanced Competition Resolution**: Uses Blockstream API for precise transaction ordering in close timestamp scenarios
- **Fallback Systems**: Automatic failover to polling mode if WebSocket connections fail
- **Registry Validation Suite**: Three specialized tools for comparing, validating, and resolving conflicts between registries

---

## Validation Tools Suite

This repository includes three specialized tools for Bitcoin bitmap registry management and validation:

### 1. sat-comparator.mjs - Registry Validation Tool

**Purpose**: Compare and validate sat-to-block mappings between two registry sources.

**Key Features**:
- Supports local files, URLs (HTTP/HTTPS), and GitHub raw URLs
- Flexible property name handling (`"block"` or `"blockheight"`)
- Detailed conflict categorization (block conflicts, sat conflicts, file-only entries)
- Export reports in JSON and CSV formats
- Exit codes for CI/CD integration (0 = identical, 1 = differences found)

**Usage**:
```bash
# Basic comparison
node sat-comparator.mjs file1.json file2.json

# Compare with GitHub URL
node sat-comparator.mjs local-file.json "https://raw.githubusercontent.com/user/repo/main/file.json"

# Export detailed reports
node sat-comparator.mjs file1.json file2.json --export-all

# Show help
node sat-comparator.mjs --help
```

**Command-Line Options**:
- `--help, -h` - Show detailed usage information
- `--export-report` - Export detailed JSON report
- `--export-csv` - Export differences as CSV
- `--export-all` - Export both JSON report and CSV

**What It Detects**:
- 🚨 **Block Conflicts** - Same block, different sats (critical!)
- 🔴 **Sat Conflicts** - Same sat, different blocks
- 📄 **File1-only entries** - Sats that exist only in File 1
- 📄 **File2-only entries** - Sats that exist only in File 2

**Output Example**:
```
=== COMPARISON SUMMARY ===
File 1 entries: 5000
File 2 entries: 5020
Conflicts (different blocks): 3
File 1 only: 15
File 2 only: 35
Total differences found: 53

=== CRITICAL DIFFERENCES ===

🚨 BLOCK CONFLICTS (Same block, different sats): 2 total
  1. Block 12345: File1→Sat 1234567890, File2→Sat 9876543210
  2. Block 67890: File1→Sat 5555555555, File2→Sat 6942069420
```

**Programmatic Usage**:
```javascript
import { SatComparator } from './sat-comparator.mjs';

const comparator = new SatComparator();
await comparator.compareFiles(file1Path, file2Path);
comparator.displayResults();

// Access results
console.log(comparator.stats);        // Summary statistics
console.log(comparator.differences);  // Array of differences
```

---

### 2. validator.mjs - Multi-File Registry Validator

**Purpose**: Batch validate all `sat_*.json` files between two GitHub registries with comprehensive conflict reporting.

**Key Features**:
- Fetches all `sat_*.json` files from both repositories
- Compares each file pair using `sat-comparator.mjs`
- Fetches inscription IDs for block conflicts from registry files
- Generates timestamped comprehensive reports
- In-memory mode for programmatic access to conflicts

**Configuration** (edit in constructor):
```javascript
constructor() {
    this.repo1Base = 'https://raw.githubusercontent.com/your-org/repo1/main/Registry/';
    this.repo2Base = 'https://raw.githubusercontent.com/your-org/repo2/main/Registry/';
    this.repo1ListUrl = 'https://api.github.com/repos/your-org/repo1/contents/Registry';
    this.repo2ListUrl = 'https://api.github.com/repos/your-org/repo2/contents/Registry';
}
```

**Usage**:
```bash
# Configure repository URLs in constructor first, then run:
node validator.mjs

# Show help
node validator.mjs --help
```

**What It Does**:
1. **Step 1**: Fetches file lists from both GitHub repositories
2. **Step 2**: Compares each `sat_*.json` file pair
3. **Step 3**: Fetches inscription IDs for all block conflicts
4. **Step 4**: Generates comprehensive timestamped report

**Output Files**:
Creates `sat-comparison-YYYY-MM-DD_HH-MM-SS.txt` with:
- **Overall Summary**: Total files compared, conflicts found, differences count
- **Block Conflicts List**: Sorted by block height with inscription IDs from both repos
- **Critical Issues Section**: Files with conflicts and their inscription IDs
- **Detailed File-by-File Results**: Complete breakdown of each comparison

**Programmatic Usage**:
```javascript
import { RegistryComparator } from './validator.mjs';

const comparator = new RegistryComparator();
const result = await comparator.run();

// Access conflicts in-memory
console.log(result.conflicts);  // Array of block conflicts
console.log(result.stats);      // Summary statistics
```

---

### 3. true-bitmap.mjs - First-is-First Conflict Resolver

**Purpose**: Resolve block conflicts using Bitcoin's First-is-First (FiF) rules with Blockstream API verification.

**Key Features**:
- Uses Blockstream API for precise Bitcoin transaction ordering
- Applies First-is-First rules for competition resolution
- Handles identical inscription IDs with sat validation
- Generates detailed winner reports with reasoning
- Includes winning/losing sat numbers in output

**Usage**:
```bash
# Run conflict resolution pipeline
node true-bitmap.mjs

# Show help
node true-bitmap.mjs --help
```

**Configuration**:
Imports `validator.mjs` for conflict detection. Edit repo URLs in the validator constructor.

**What It Does**:
1. **Step 1**: Runs validator to detect block conflicts
2. **Step 2**: Resolves each conflict using Blockstream API
3. **Step 3**: Applies First-is-First rules for competition
4. **Step 4**: Generates winner report with detailed reasoning

**Resolution Logic**:
- **Block Height Comparison**: Earlier inscription block wins
- **Same Block**: Uses Bitcoin transaction position
- **Identical Inscription ID**: Validates actual satoshi number
- **Edge Cases**: Handles unconfirmed transactions and missing data

**Output Files**:
Creates `true-bitmaps-YYYY-MM-DD_HH-MM-SS.txt` with:
- Summary statistics (Repo1 wins, Repo2 wins, both match, etc.)
- Blocks grouped by winner in 4 columns
- Detailed winner list with inscription IDs, sat numbers, and reasoning

---

## Tool Dependencies

| Tool | Depends On | Purpose |
|------|------------|---------|
| `sat-comparator.mjs` | None | Standalone comparison utility |
| `validator.mjs` | `sat-comparator.mjs` | Batch file validation |
| `true-bitmap.mjs` | `validator.mjs` | FiF conflict resolution |

---

## Complete Registry Validation Pipeline

**Recommended Workflow**:

```bash
# Step 1: Compare individual sat files (optional)
node sat-comparator.mjs sat_file1.json sat_file2.json --export-all

# Step 2: Validate entire registry (configure repos first)
node validator.mjs

# Step 3: Resolve conflicts with FiF rules
node true-bitmap.mjs
```

**This pipeline ensures**:
- ✅ Individual file accuracy
- ✅ Complete registry validation
- ✅ True winner determination via Bitcoin FiF rules

---

## Installation

### Prerequisites
- Node.js (version 14 or higher)
- npm or yarn package manager
- GitHub Personal Access Token with repository write permissions (for bitmap indexer only)

### Setup
1. Clone or download the scripts
2. Install dependencies:

```bash
npm install ws dotenv
```

3. For bitmap indexer: Create environment file `.env`:

```
GITHUB_TOKEN=your_personal_access_token_here
```

4. Configure GitHub repository settings (edit the `GITHUB_CONFIG` object in bitmap.mjs):

```javascript
const GITHUB_CONFIG = {
    token: process.env.GITHUB_TOKEN,
    owner: 'your-github-username',
    repo: 'your-bitmap-registry-repo',
    branch: 'main',
    path: 'Registry'
};
```

5. Make scripts executable (Unix/Linux/macOS):

```bash
chmod +x bitmap.mjs sat-comparator.mjs validator.mjs true-bitmap.mjs
```

---

## Bitmap Indexer Usage

### Live Monitoring Mode
Monitor new blocks as they are mined for bitmap inscriptions:

```bash
node bitmap.mjs
```
or
```bash
./bitmap.mjs
```

### Single Block Analysis
Analyze a specific block for bitmap inscriptions:

```bash
node bitmap.mjs <block_height>
```

Example:
```bash
node bitmap.mjs 820000
```

### Read-Only Mode
Analyze all bitmap inscriptions without any registry operations:

```bash
node bitmap.mjs <block_height> --read
```

Example:
```bash
node bitmap.mjs 820000 --read
```

**Read-Only Mode Features**:
- No GitHub token required
- No registry initialization or GitHub operations
- No competition resolution (shows all bitmap attempts)
- Faster execution for exploration purposes
- Perfect for analysis without affecting registries

### Historical Range Monitoring
Start monitoring from a specific block height:

```bash
node bitmap.mjs --start-height <block_height>
```

Example:
```bash
node bitmap.mjs --start-height 820000
```

### Debug Mode
Enable detailed logging and metadata output:

```bash
node bitmap.mjs --debug
```

### Custom Configuration
Specify custom registry folder and GitHub repository:

```bash
node bitmap.mjs --registry-folder ./custom-registry --github-repo username/repo-name
```

---

## Output Format

### Bitmap Registration Display
When valid bitmap registrations are found:

```
Block 820123 - Valid Bitmap Registrations Found (3 total):
✓ Bitmap 12345.bitmap -> Sat 1234567890123456 (abc123...i0)
✓ Bitmap 67890.bitmap -> Sat 2345678901234567 (def456...i0)
✓ Bitmap 54321.bitmap -> Sat 3456789012345678 (ghi789...i0)
```

### Read-Only Mode Display
When using `--read` flag, all bitmap attempts are shown without competition resolution:

```
=== BITMAP READ-ONLY RESULTS ===
Block: 820123
Total Inscriptions: 150
Bitmap Attempts Found: 5

All Bitmap Attempts (no competition resolution):
  • 12345.bitmap -> Sat 1234567890123456 (abc123...i0)
  • 12345.bitmap -> Sat 2345678901234567 (def456...i0)  # Multiple attempts shown
  • 67890.bitmap -> Sat 3456789012345678 (ghi789...i0)
  • 54321.bitmap -> Sat 4567890123456789 (jkl012...i0)
  • 99999.bitmap -> Sat 5678901234567890 (mno345...i0)
```

### Competition Resolution (Normal Mode)
When multiple inscriptions compete for the same bitmap:

```
=== ENHANCED COMPETITION RESOLUTION FOR BITMAP 12345 ===
Contestants: 3
All 3 contestants in block 820123, checking timestamps...
Timestamp range: 1640995200 to 1640995201 (difference: 1)
⚡ Timestamps are within 1 units (≤ 500), REQUIRED Bitcoin transaction ordering...
Getting Bitcoin tx data for abc123...i0 (tx: abc123...)
🏆 WINNER: True FiF winner - inscription abc123...i0 (Bitcoin tx position 15)
=== COMPETITION COMPLETE ===
```

### Status Logging
Regular status updates show monitoring progress:

```
[2024-01-15T10:30:00.000Z] [INFO] STATUS: Uptime 15m, Blocks: 5, Inscriptions: 42, Last Block: 820125
```

---

## Registry Structure

### Main Registry Files
The system creates registry files organized by block height ranges:
- `0-9999.json` - Bitmaps for blocks 0-9999
- `10000-19999.json` - Bitmaps for blocks 10000-19999
- etc.

Each file contains entries in the format:

```json
[{"block": 12345, "iD": "abc123def456...i0", "sat": 1234567890123456}]
```

### Sat Lookup Files
Reverse lookup files for finding which block a sat belongs to:
- `sat_491073444061627-518823050782269.json`
- Format: `sat_{min_sat}-{max_sat}.json`

Each file contains entries in the format:

```json
[{"sat": 1234567890123456, "block": 12345}]
```

---

## Bitmap Validation Rules

### Content Requirements
1. **Content Type**: Must be `text/plain` or `text/plain;charset=utf-8`
2. **Format**: Must match exactly `{number}.bitmap` (e.g., `12345.bitmap`)
3. **Block Validity**: The number must be ≤ current block height
4. **No Leading Zeros**: Numbers cannot have leading zeros

### Competition Resolution
When multiple inscriptions claim the same bitmap:

1. **First-is-First**: The inscription that appears first in Bitcoin's transaction order wins
2. **Same Block**: Uses Bitcoin transaction ordering within the block
3. **Different Timestamps**: If timestamps differ by >500 units, earliest wins
4. **Close Timestamps**: Uses Blockstream API for precise transaction ordering

---

## Technical Details

### Data Sources
- **Block Notifications**: mempool.space WebSocket API
- **Inscription Data**: ordinals.com API endpoints
- **Transaction Ordering**: Blockstream API for competition resolution
- **Registry Storage**: GitHub API for persistent storage

### Sequential Run Optimization
- **Cache Management**: Maintains local registry cache for sequential runs
- **GitHub Sync**: Only fetches from GitHub on fresh starts or gaps
- **Atomic Updates**: Ensures registry consistency during updates

### Error Handling
- **Critical Failures**: Registry operations must succeed or processing stops
- **Network Resilience**: Automatic retry with exponential backoff
- **Data Integrity**: Comprehensive validation at all stages

### Performance
- **Batch Processing**: Processes inscriptions in configurable batches
- **Rate Limiting**: Respects API rate limits with automatic delays
- **Memory Efficiency**: Streams data processing with minimal memory footprint
- **Read-Only Optimization**: Skips registry operations for faster execution

---

## API Endpoints Used

| Service | Endpoint | Purpose |
|---------|----------|---------|
| mempool.space | `wss://mempool.space/api/v1/ws` | Real-time block notifications |
| mempool.space | `https://mempool.space/api/blocks/tip/height` | Current block height |
| ordinals.com | `https://ordinals.com/inscriptions/block/{height}` | Block inscriptions |
| ordinals.com | `https://ordinals.com/r/inscription/{id}` | Inscription metadata |
| ordinals.com | `https://ordinals.com/content/{id}` | Inscription content |
| blockstream.info | `https://blockstream.info/api/tx/{txid}` | Transaction data |
| blockstream.info | `https://blockstream.info/api/block/{hash}/txids` | Block transaction ordering |
| GitHub API | `https://api.github.com/repos/{owner}/{repo}/contents/*` | Registry storage |

---

## Configuration

### Environment Variables

```
GITHUB_TOKEN=your_personal_access_token  # Not required for --read mode or validation tools
BLOCKSTREAM_API_URL=https://blockstream.info/api  # Optional, defaults to blockstream.info
```

### Registry Settings
- **Local Cache**: `./bitmap-registry/` (configurable with `--registry-folder`)
- **Sat Lookup Cache**: `./sat-lookup-registry/`
- **Persistence File**: `./.lastprocessed` (tracks last processed block)

### API Limits and Timeouts
- **Request Timeout**: 30 seconds
- **Maximum Retries**: 3-5 attempts (varies by operation criticality)
- **Rate Limiting**: Automatic delays and retry-after header respect
- **GitHub Delays**: 200-300ms between pushes (can be reduced significantly once your repo is up to date)

---

## Command Line Arguments

### Bitmap Indexer

| Argument | Description | Example | Compatible Modes |
|----------|-------------|---------|------------------|
| `<block_height>` | Process a single specific block | `node bitmap.mjs 820000` | Normal, Read-only |
| `--read` | Enable read-only mode (no GitHub ops, no competition) | `node bitmap.mjs 820000 --read` | Single block only |
| `--start-height <height>` | Start monitoring from specific height | `--start-height 820000` | Live monitoring |
| `--start-block <height>` | Alias for --start-height | `--start-block 820000` | Live monitoring |
| `--debug` | Enable debug mode with detailed output | `--debug` | All modes |
| `--registry-folder <path>` | Custom local registry folder | `--registry-folder ./custom-registry` | Normal mode |
| `--github-repo <owner/repo>` | Override GitHub repository | `--github-repo username/bitmap-repo` | Normal mode |

### Mode Restrictions
- `--read` flag can **only** be used with single block mode
- `--read` flag **cannot** be used with `--start-height` or live monitoring
- Read-only mode bypasses all GitHub operations and registry management

---

## Operation Modes

### 1. Live Monitoring Mode

```bash
node bitmap.mjs
```
- Continuously monitors for new blocks
- Full GitHub integration and registry management
- Competition resolution with first-is-first rules
- Requires GitHub token

### 2. Single Block Mode

```bash
node bitmap.mjs 792435
```
- Analyzes one specific block
- Full GitHub integration and registry management
- Competition resolution with first-is-first rules
- Requires GitHub token

### 3. Read-Only Mode

```bash
node bitmap.mjs 792435 --read
```
- Analyzes one specific block without any registry operations
- No GitHub token required
- No competition resolution (shows all attempts)
- Perfect for exploration and analysis

### 4. Historical Range Mode

```bash
node bitmap.mjs --start-height 792435
```
- Processes historical blocks then switches to live monitoring
- Full GitHub integration and registry management
- Competition resolution with first-is-first rules
- Requires GitHub token
- Block 792435 = genesis block for bitmaps

---

## Troubleshooting

### Common Issues

**GitHub API Errors**
- Verify your GitHub token has repository write permissions
- Check repository exists and you have access
- Ensure branch name matches configuration

**Read-Only Mode Errors**
- Ensure you're using `--read` with a specific block number only
- Cannot be combined with `--start-height` or live monitoring

**Competition Resolution Failures**
- Blockstream API issues may affect close timestamp competitions
- Script will retry with exponential backoff
- Check network connectivity to blockstream.info

**Registry Sync Issues**
- Failed GitHub pushes will prevent `.lastprocessed` updates in live mode
- Single block mode continues despite sync failures (with warnings)
- Check GitHub rate limits and repository size

**Memory Usage**
- Large blocks with many inscriptions may use significant memory
- Bitmap validation processes all text/plain inscriptions
- Monitor system resources during operation

**Validation Tool Errors**
- Ensure repository URLs are correct in validator configuration
- Check network connectivity for GitHub API access
- Verify sat_*.json files exist in specified paths

### Debug Mode
Enable comprehensive debugging:

```bash
node bitmap.mjs --debug
node bitmap.mjs 792435 --read --debug
node sat-comparator.mjs file1.json file2.json --debug
```

Provides:
- Full inscription metadata and content logging
- Competition resolution step-by-step details
- GitHub API request/response logging
- Transaction ordering analysis
- Processing timing information

### Log Levels
- **INFO**: Normal operation messages
- **WARN**: Non-critical issues (e.g., API rate limits, missing data)
- **ERROR**: Critical failures requiring attention

---

## Module Exports

### Bitmap Indexer

The script can be imported as a module:

```javascript
import { 
    processBlockForBitmaps,
    processBlockForBitmapsReadOnly,
    validateBitmapContent,
    isBitmapRegistered,
    registerBitmap,
    initializeBitmapRegistry,
    startLiveMonitoring,
    startFromHeight
} from './bitmap.mjs';
```

**Key Exported Functions**:
- `processBlockForBitmaps(blockHeight, isLiveMode)` - Process a single block for bitmap inscriptions
- `validateBitmapContent(content, currentBlockHeight)` - Validate bitmap format and constraints
- `isBitmapRegistered(blockHeight)` - Check if a bitmap is already registered
- `registerBitmap(blockHeight, satNumber, inscriptionId, timestamp, blockFound)` - Register a new bitmap
- `initializeBitmapRegistry(currentBlock)` - Initialize registry cache and GitHub sync
- `startLiveMonitoring()` - Begin real-time monitoring
- `startFromHeight(startHeight)` - Begin monitoring from specific block

### Validation Tools

```javascript
import { SatComparator } from './sat-comparator.mjs';
import { RegistryComparator } from './validator.mjs';
import { TrueBitmapResolver } from './true-bitmap.mjs';
```

---

## Registry Integrity

### Atomic Operations
- All registry updates are atomic - either all files update successfully or none do
- Failed GitHub pushes prevent `.lastprocessed` file updates to ensure consistency
- Local cache maintains state consistency across runs

### Conflict Resolution
- First-is-First rule strictly enforced using Bitcoin transaction ordering
- Close timestamp competitions require Blockstream API verification
- Existing registrations are never overwritten

### Data Validation
- Comprehensive validation at input, processing, and output stages
- Format validation for all bitmap content
- Block height and timestamp consistency checks

---

## Use Cases

### Registry Management (Normal Mode)
- Building and maintaining official bitmap registries
- Real-time monitoring for new bitmap claims
- Ensuring first-is-first rule compliance

### Research and Analysis (Read-Only Mode)
- Exploring bitmap activity in specific blocks
- Analyzing competition patterns without affecting registries
- Quick bitmap attempt discovery for research purposes
- Testing and validation without GitHub operations

### Historical Analysis (Range Mode)
- Processing historical blocks for complete registry building
- Catching up on missed blocks in live monitoring setups

### Registry Validation (Validation Tools)
- Comparing registries from different sources
- Detecting conflicts and data integrity issues
- Resolving disputed bitmap claims using Bitcoin FiF rules
- Auditing registry accuracy across repositories

---

## License

This script is provided as-is for educational and research purposes. Please respect the APIs' terms of service and rate limits.

---

## Contributing

Feel free to submit issues, feature requests, or improvements. The scripts are designed to be modular and extensible.

---

## Disclaimer

This tool is for informational purposes only. This script provides a best-effort real-time view based on first-is-first principles. Always verify critical information through multiple sources.

---

## Version History

- **v1.0**: Historical and LIVE Bitmap monitoring with enhanced competition resolution, GitHub integration, and sequential run optimization under multiple modes and conditional flags
- **v1.1**: Added comprehensive validation tools suite (sat-comparator, validator, true-bitmap) for registry conflict detection and resolution
