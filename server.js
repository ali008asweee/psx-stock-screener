/* ========================================================================
   PSX Stock Screener — Node.js Backend Server
   Fetches live data from dps.psx.com.pk and serves it as JSON API
   ======================================================================== */

const express = require('express');
const path = require('path');
const { load } = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname)));

// PSX Sector code mapping
const SECTOR_MAP = {
    '0801': 'Automobile Assembler',
    '0802': 'Automobile Parts & Accessories',
    '0803': 'Cable & Electrical Goods',
    '0804': 'Cement',
    '0805': 'Chemical',
    '0806': 'Close-End Mutual Fund',
    '0807': 'Commercial Banks',
    '0808': 'Engineering',
    '0809': 'Fertilizer',
    '0810': 'Food & Personal Care Products',
    '0811': 'Glass & Ceramics',
    '0812': 'Insurance',
    '0813': 'Inv. Banks / Securities Cos.',
    '0814': 'Jute',
    '0815': 'Leasing Companies',
    '0816': 'Leather & Tanneries',
    '0818': 'Miscellaneous',
    '0819': 'Modarabas',
    '0820': 'Oil & Gas Exploration',
    '0821': 'Oil & Gas Marketing',
    '0822': 'Paper, Board & Packaging',
    '0823': 'Pharmaceuticals',
    '0824': 'Power Generation & Distribution',
    '0825': 'Refinery',
    '0826': 'Sugar & Allied Industries',
    '0827': 'Synthetic & Rayon',
    '0828': 'Technology & Communication',
    '0829': 'Textile Composite',
    '0830': 'Textile Spinning',
    '0831': 'Textile Weaving',
    '0832': 'Tobacco',
    '0833': 'Transport',
    '0834': 'Vanaspati & Allied Industries',
    '0835': 'Woollen',
    '0836': 'Real Estate Investment Trust',
    '0837': 'Exchange Traded Funds',
    '0838': 'Property',
    '0839': 'Apparel',
};

// Simple in-memory cache
let stockCache = { data: null, timestamp: 0 };
let indexCache = { data: null, timestamp: 0 };
const CACHE_DURATION = 60 * 1000; // 1 minute cache

// ─── Fetch and Parse PSX Screener Page ───
async function fetchStockData() {
    const now = Date.now();
    if (stockCache.data && (now - stockCache.timestamp) < CACHE_DURATION) {
        return stockCache.data;
    }

    console.log('[PSX] Fetching live stock data from dps.psx.com.pk/screener...');
    
    const response = await fetch('https://dps.psx.com.pk/screener', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
        }
    });

    if (!response.ok) {
        throw new Error(`PSX responded with status ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);
    
    const stocks = [];
    
    $('#screenerTable tbody tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length < 11) return;

        const symbolLink = $(cells[0]).find('a.tbl__symbol');
        const symbol = symbolLink.text().trim();
        const name = symbolLink.attr('data-title') || symbol;
        const sectorCode = $(cells[1]).text().trim();
        const listedIn = $(cells[2]).text().trim();
        
        // Extract numeric values from data-order attributes
        const marketCap = parseFloat($(cells[3]).attr('data-order')) || 0;
        const price = parseFloat($(cells[4]).attr('data-order')) || 0;
        const changePercent = parseFloat($(cells[5]).attr('data-order')) || 0;
        const yearChange = parseFloat($(cells[6]).attr('data-order')) || 0;
        const peRatio = parseFloat($(cells[7]).attr('data-order')) || 0;
        const divYield = parseFloat($(cells[8]).attr('data-order')) || 0;
        const freeFloat = parseFloat($(cells[9]).attr('data-order')) || 0;
        const volume30Avg = parseFloat($(cells[10]).attr('data-order')) || 0;

        // Skip stocks with no price
        if (price <= 0) return;
        
        // Check for non-compliant tag
        const hasNC = $(cells[0]).find('.tag').text().trim() === 'NC';
        
        stocks.push({
            symbol,
            name,
            sectorCode,
            sector: SECTOR_MAP[sectorCode] || sectorCode || 'Other',
            listedIn,
            price,
            change: changePercent,
            yearChange,
            mcap: marketCap,
            pe: peRatio,
            divYield,
            freeFloat,
            volume: volume30Avg,
            isNC: hasNC,
            // Indices membership
            isKSE100: listedIn.includes('KSE100'),
            isKSE30: listedIn.includes('KSE30'),
            isKMI30: listedIn.includes('KMI30'),
        });
    });

    console.log(`[PSX] Parsed ${stocks.length} stocks from PSX screener.`);
    
    stockCache = { data: stocks, timestamp: now };
    return stocks;
}

// ─── Fetch Index Data from PSX Homepage ───
async function fetchIndexData() {
    const now = Date.now();
    if (indexCache.data && (now - indexCache.timestamp) < CACHE_DURATION) {
        return indexCache.data;
    }

    console.log('[PSX] Fetching index data from dps.psx.com.pk...');

    const response = await fetch('https://dps.psx.com.pk/', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
        }
    });

    if (!response.ok) {
        throw new Error(`PSX responded with status ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);

    const indices = [];
    $('.topIndices__item').each((i, item) => {
        const name = $(item).find('.topIndices__item__name').text().trim();
        const value = $(item).find('.topIndices__item__val').text().trim().replace(/,/g, '');
        const changeEl = $(item).find('.topIndices__item__change');
        const changeText = changeEl.text().trim().replace(/,/g, '');
        const changePText = $(item).find('.topIndices__item__changep').text().trim();
        const isPositive = $(item).find('.change__text--pos').length > 0;

        if (name && value) {
            indices.push({
                name,
                value: parseFloat(value) || 0,
                change: parseFloat(changeText.replace(/[^\d.-]/g, '')) || 0,
                changePercent: parseFloat(changePText.replace(/[()%]/g, '')) || 0,
                isPositive,
            });
        }
    });

    // Extract market state
    let marketState = 'Closed';
    let totalTrades = 0;
    let totalVolume = 0;
    let totalValue = 0;
    
    // Try to find the Regular market card
    $('.markets__item').each((i, item) => {
        const title = $(item).find('.markets__item__title').text().trim();
        if (title === 'Regular') {
            const stats = $(item).find('.markets__item__stat div:not(.markets__item__stat__label)');
            if (stats.length >= 4) {
                marketState = $(stats[0]).text().trim();
                totalTrades = parseInt($(stats[1]).text().trim().replace(/,/g, '')) || 0;
                totalVolume = parseInt($(stats[2]).text().trim().replace(/,/g, '')) || 0;
                totalValue = parseFloat($(stats[3]).text().trim().replace(/,/g, '')) || 0;
            }
        }
    });

    const result = {
        indices,
        market: {
            state: marketState,
            trades: totalTrades,
            volume: totalVolume,
            value: totalValue,
        },
        fetchedAt: new Date().toISOString(),
    };

    indexCache = { data: result, timestamp: now };
    return result;
}

// ─── API Routes ───

// Get all stocks with live data
app.get('/api/stocks', async (req, res) => {
    try {
        const stocks = await fetchStockData();
        res.json({
            success: true,
            count: stocks.length,
            fetchedAt: new Date(stockCache.timestamp).toISOString(),
            data: stocks,
        });
    } catch (error) {
        console.error('[PSX] Error fetching stocks:', error.message);
        // If cache exists, return stale data
        if (stockCache.data) {
            res.json({
                success: true,
                count: stockCache.data.length,
                fetchedAt: new Date(stockCache.timestamp).toISOString(),
                stale: true,
                data: stockCache.data,
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to fetch data from PSX. Please try again.' 
            });
        }
    }
});

// Get index data
app.get('/api/indices', async (req, res) => {
    try {
        const data = await fetchIndexData();
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('[PSX] Error fetching indices:', error.message);
        if (indexCache.data) {
            res.json({ success: true, stale: true, ...indexCache.data });
        } else {
            res.status(500).json({ success: false, error: 'Failed to fetch index data.' });
        }
    }
});

// Force refresh (clear cache)
app.post('/api/refresh', (req, res) => {
    stockCache = { data: null, timestamp: 0 };
    indexCache = { data: null, timestamp: 0 };
    res.json({ success: true, message: 'Cache cleared. Next request will fetch fresh data.' });
});

// Fallback to index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start Server ───
app.listen(PORT, () => {
    console.log(`\n  🚀 PSX Stock Screener is running!`);
    console.log(`  📊 Open http://localhost:${PORT} in your browser`);
    console.log(`  📡 Live data from dps.psx.com.pk\n`);
});
