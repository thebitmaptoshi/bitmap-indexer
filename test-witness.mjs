#!/usr/bin/env node
import https from 'https';
import { config } from 'dotenv';

config({ path: './thebitmaptoshi.env' });

const BLOCKSTREAM_CONFIG = {
    baseUrl: process.env.BLOCKSTREAM_API_URL || 'https://blockstream.info/api',
    clientId: process.env.BLOCKSTREAM_CLIENT_ID || null,
    clientSecret: process.env.BLOCKSTREAM_CLIENT_SECRET || null,
    hasCredentials: !!(process.env.BLOCKSTREAM_CLIENT_ID && process.env.BLOCKSTREAM_CLIENT_SECRET),
    timeout: 30000,
    tokenUrl: 'https://login.blockstream.com/realms/blockstream-public/protocol/openid-connect/token',
    accessToken: null,
    tokenExpiry: null
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function fetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = https;
        
        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 30000
        };

        const req = client.request(requestOptions, (res) => {
            const chunks = [];
            let totalLength = 0;

            res.on('data', chunk => {
                chunks.push(chunk);
                totalLength += chunk.length;
            });

            res.on('end', () => {
                const buffer = Buffer.concat(chunks, totalLength);
                const data = buffer.toString('utf8');

                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    statusText: res.statusMessage || '',
                    headers: {
                        get: (name) => res.headers[name.toLowerCase()]
                    },
                    text: () => Promise.resolve(data),
                    json: () => Promise.resolve(JSON.parse(data))
                });
            });
        });

        req.on('error', (error) => {
            console.error(`❌ Request error: ${error.message}`);
            reject(new Error(`Request failed: ${error.message}`));
        });
        req.on('timeout', () => { 
            console.error(`❌ Request timeout`);
            req.destroy(); 
            reject(new Error('Request timeout')); 
        });
        
        if (options.body) {
            req.write(options.body);
        }
        
        req.end();
    });
}

async function getBlockstreamAccessToken() {
    if (!BLOCKSTREAM_CONFIG.hasCredentials) {
        console.log('ℹ️  No Blockstream credentials found, using public API');
        return null;
    }

    if (BLOCKSTREAM_CONFIG.accessToken && BLOCKSTREAM_CONFIG.tokenExpiry && Date.now() < BLOCKSTREAM_CONFIG.tokenExpiry) {
        console.log('ℹ️  Using cached access token');
        return BLOCKSTREAM_CONFIG.accessToken;
    }

    try {
        console.log('🔑 Requesting Blockstream access token...');

        const params = new URLSearchParams();
        params.append('client_id', BLOCKSTREAM_CONFIG.clientId);
        params.append('client_secret', BLOCKSTREAM_CONFIG.clientSecret);
        params.append('grant_type', 'client_credentials');
        params.append('scope', 'openid');

        const response = await fetch(BLOCKSTREAM_CONFIG.tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString(),
            timeout: BLOCKSTREAM_CONFIG.timeout
        });

        if (!response.ok) {
            throw new Error(`Token request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        BLOCKSTREAM_CONFIG.accessToken = data.access_token;
        BLOCKSTREAM_CONFIG.tokenExpiry = Date.now() + ((data.expires_in - 30) * 1000);

        console.log(`✅ Token obtained, expires in ${data.expires_in}s`);
        return BLOCKSTREAM_CONFIG.accessToken;

    } catch (error) {
        console.error(`❌ Failed to get token: ${error.message}`);
        return null;
    }
}

async function fetchBitcoinAPI(endpoint) {
    const url = `${BLOCKSTREAM_CONFIG.baseUrl}${endpoint}`;
    console.log(`🌐 Fetching: ${url}`);

    const headers = {
        'User-Agent': 'Bitmap-Registry-Bot/1.0'
    };

    if (BLOCKSTREAM_CONFIG.hasCredentials) {
        const accessToken = await getBlockstreamAccessToken();
        if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
            console.log('🔐 Using authenticated request');
        }
    }

    const response = await fetch(url, {
        headers,
        timeout: BLOCKSTREAM_CONFIG.timeout
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
    }

    await sleep(5);
    return response;
}

function parseInscriptionFromTxHex(txHex) {
    try {
        if (!txHex || typeof txHex !== 'string') {
            console.error('❌ Invalid txHex input');
            return { contentType: null, contentSample: null, rawWitness: null };
        }

        const lower = txHex.toLowerCase();
        const marker = '6f7264'; // hex for "ord"
        const pos = lower.indexOf(marker);
        
        if (pos === -1) {
            console.log('❌ No "ord" marker found in transaction');
            return { contentType: null, contentSample: null, rawWitness: null };
        }

        console.log(`\n📍 Found 'ord' marker at position ${pos}`);

        // Extract a larger snippet for analysis (up to 2KB after marker)
        const snippetHex = lower.substring(pos, Math.min(lower.length, pos + 4000));
        const buf = Buffer.from(snippetHex.replace(/\s+/g, ''), 'hex');
        
        console.log(`📦 Extracted ${buf.length} bytes after 'ord' marker`);
        console.log(`🔢 Raw hex (first 200 chars): ${snippetHex.substring(0, 200)}`);

        // Try to decode as UTF-8
        const ascii = buf.toString('utf8', 0, Math.min(buf.length, 2000));
        console.log(`📝 UTF-8 decoded (first 500 chars): ${ascii.substring(0, 500)}`);

        // Find content-type
        const ctMatch = ascii.match(/(text\/[^\x00\s;]+(?:;[^\x00\r\n]*)?)/i);
        let contentType = null;
        let contentSample = null;

        if (ctMatch) {
            contentType = ctMatch[1].toLowerCase();
            console.log(`📋 Found content-type: ${contentType}`);

            const prefix = ascii.slice(0, ctMatch.index + ctMatch[0].length);
            const prefixByteLen = Buffer.byteLength(prefix, 'utf8');

            // Search for null separator
            let payloadStart = -1;
            for (let i = prefixByteLen; i < Math.min(buf.length, prefixByteLen + 512); i++) {
                if (buf[i] === 0x00) { 
                    payloadStart = i + 1; 
                    console.log(`🎯 Found null separator at byte ${i}`);
                    break; 
                }
            }

            if (payloadStart === -1) {
                payloadStart = prefixByteLen;
                console.log(`⚠️ No null separator found, using prefix length: ${payloadStart}`);
            }

            const sampleEnd = Math.min(payloadStart + 256, buf.length);
            const payloadSlice = buf.slice(payloadStart, sampleEnd);
            contentSample = payloadSlice.toString('utf8').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '.').trim();
            
            console.log(`📄 Content sample (${payloadSlice.length} bytes): "${contentSample}"`);
        } else {
            console.log(`⚠️ No content-type found in witness data`);
            // Extract first printable region
            const printable = ascii.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '.');
            contentSample = printable.substring(0, 256).trim();
            console.log(`📄 Fallback content sample: "${contentSample}"`);
        }

        return { 
            contentType, 
            contentSample: contentSample || null,
            rawWitness: snippetHex.substring(0, 400) // First 200 hex chars for debugging
        };
    } catch (e) {
        console.error(`❌ Parse error: ${e.message}`);
        console.error(e.stack);
        return { contentType: null, contentSample: null, rawWitness: null };
    }
}

async function testInscription(inscriptionId) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 Testing inscription: ${inscriptionId}`);
    console.log(`${'='.repeat(80)}`);

    try {
        // Extract txid
        const txid = inscriptionId.replace(/i\d+$/, '');
        console.log(`\n📌 Transaction ID: ${txid}`);

        // Fetch tx hex from Bitcoin
        console.log(`\n⬇️  Fetching transaction hex from Bitcoin...`);
        const txHexResp = await fetchBitcoinAPI(`/tx/${txid}/hex`);
        const txHex = (await txHexResp.text()).trim();
        
        console.log(`✅ Got tx hex, length: ${txHex.length} characters`);

        // Parse inscription from witness data
        console.log(`\n🔬 Parsing witness data...`);
        const parsed = parseInscriptionFromTxHex(txHex);

        console.log(`\n${'='.repeat(80)}`);
        console.log(`📊 RESULTS:`);
        console.log(`${'='.repeat(80)}`);
        console.log(`Content-Type: ${parsed.contentType || 'NOT FOUND'}`);
        console.log(`Content Sample: ${parsed.contentSample || 'NOT FOUND'}`);
        console.log(`Content Length: ${parsed.contentSample ? parsed.contentSample.length : 0} chars`);
        
        // Validate bitmap format
        const bitmapRegex = /^(\d{1,16})\.bitmap$/;
        if (parsed.contentSample && bitmapRegex.test(parsed.contentSample)) {
            console.log(`\n✅ VALID BITMAP FORMAT: ${parsed.contentSample}`);
        } else {
            console.log(`\n❌ NOT A BITMAP (content: "${parsed.contentSample || 'empty'}")`);
        }

        console.log(`\n🔢 Raw Witness (first 200 hex chars):`);
        console.log(parsed.rawWitness || 'NOT FOUND');

    } catch (error) {
        console.error(`\n❌ ERROR: ${error.message}`);
        console.error(error.stack);
    }
}

// Main
console.log('🚀 Starting witness data test...');
console.log(`📁 Loading env from: ./thebitmaptoshi.env`);
console.log(`🔧 Blockstream API: ${BLOCKSTREAM_CONFIG.baseUrl}`);
console.log(`🔑 Has credentials: ${BLOCKSTREAM_CONFIG.hasCredentials}`);

const inscriptionId = process.argv[2] || '00000ae964c360c95e4455fd51e3ba42382feeba3c160610845b4d26826be66fi24';

testInscription(inscriptionId).then(() => {
    console.log(`\n✅ Test complete`);
    process.exit(0);
}).catch(error => {
    console.error(`\n❌ Fatal error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
});