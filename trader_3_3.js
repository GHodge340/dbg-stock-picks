/**
 * TRADER V3.2 - Single-file, multi-class, lifecycle-based Alpaca bot
 * - Class-based architecture
 * - Aggressive Yahoo + Finviz scraping (no manual watchlist)
 * - Candidate/universe logging to engine_log.txt
 * - High-signal Discord alerts only
 */

require('colors');
require('dotenv').config();

const { Blob } = require('buffer');
if (typeof global.Blob === 'undefined') global.Blob = Blob;
if (typeof global.File === 'undefined') {
    global.File = class File extends Blob {
        constructor(parts, filename, options = {}) {
            super(parts, options);
            this.name = filename;
            this.lastModified = options.lastModified || Date.now();
        }
    };
}

const fetch = require('node-fetch');
const Alpaca = require('@alpacahq/alpaca-trade-api');
const cheerio = require('cheerio');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const fs = require('fs');
const ti = require('technicalindicators');

// ========== CONFIG & UTILS ==========

const geminiAI = `https://finviz.com/screener.ashx?v=111&f=cap_midover%2Cfa_epsqoq_o5%2Cfa_salesqoq_o5%2Csh_avgvol_o500%2Cta_perf_4w10o%2Cta_perf2_13w10o%2Cta_rsi_nob60%2Cta_sma20_sa50&ft=3#google_vignette`;
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

class Config {
    static load() {
        return {
            alpaca: {
                keyId: process.env.ALPACA_API_KEY,
                secretKey: process.env.ALPACA_SECRET_KEY,
                paper: process.env.ALPACA_PAPER === 'true',
            },
            alphaVKey: process.env.ALPHA_VANTAGE_KEY,
            finnhubToken: process.env.FINNHUB_TOKEN,
            discordWebhook: process.env.DISCORD_WEBHOOK_URL,
            risk: {
                riskPerTrade: 0.05,
                maxPositions: 5,
                scalpPercent: 0.07,
                stopLossPercent: 0.035,
            },
            files: {
                tradeLog: 'trade_log.json',
            },
            logFile: 'engine_log.txt',
            scanIntervalMs: 15 * 60 * 1000,
        };
    }
}

class ScoringConfig {
    static weights = {
        percentChange: 0.5,
        sentiment: 12,
        rsiBullish: 6,
        macdBullish: 6,
        trendAbove: 5,
    };
}

class Logger {
    constructor(logFile = 'engine_log.txt') {
        this.logFile = logFile;
    }

    writeToFile(message) {
        try {
            fs.appendFileSync(this.logFile, message + '\n');
        } catch (err) {
            console.error('Failed to write log file:', err.message);
        }
    }

    log(msg, color = 'white') {
        const time = new Date().toLocaleTimeString();
        const formatted = `[${time}] ${msg}`;
        console.log(formatted[color]);
        this.writeToFile(formatted);
    }

    info(msg) { this.log(msg, 'cyan'); }
    warn(msg) { this.log(msg, 'yellow'); }
    error(msg) { this.log(msg, 'red'); }
    success(msg) { this.log(msg, 'green'); }
}

// ========== DISCORD ==========

class DiscordNotifier {
    constructor(config, logger) {
        this.webhook = config.discordWebhook;
        this.logger = logger;
    }

    async send(message, embed = null) {
        if (!this.webhook) return;
        try {
            const payload = embed ? { content: message, embeds: [embed] } : { content: message };
            await fetch(this.webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (err) {
            this.logger.error(`Discord error: ${err.message}`);
        }
    }

    async startup() {
        await this.send('🚀 **Trader V3.3 started** and ready to trade.');
    }

    async buyFilled(symbol, qty, price, target, stop) {
        await this.send(
`📈 **BUY FILLED**: ${symbol}
Qty: ${qty}
Price: $${price.toFixed(2)}
Target: $${target.toFixed(2)}
Stop: $${stop.toFixed(2)}`
        );
    }

    async exit(symbol, reason, exitPrice, pnl) {
        await this.send(
`📤 **EXIT**: ${symbol}
Reason: ${reason}
Exit: $${exitPrice.toFixed(2)}
PnL: $${pnl.toFixed(2)}`
        );
    }

    async error(context, err) {
        // Silenced for Discord, logged locally
        this.logger.error(`Error in ${context}: ${err.message || err}`);
    }

    async universeEmpty() {
        await this.send('⚠️ **Universe empty** — no candidates available this cycle.');
    }

    async sourceFailure(source, msg) {
        // Silenced for Discord, logged locally
        this.logger.error(`Source failure (${source}): ${msg}`);
    }

    async sendSummary(account) {
        if (!this.webhook) return;
        try {
            const portfolioValue = parseFloat(account.portfolio_value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
            const buyingPower = parseFloat(account.buying_power).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
            const dayTrades = account.daytrade_count;
            const pdtStatus = parseFloat(account.portfolio_value) < 25000 ? `${dayTrades}/3` : `${dayTrades} (Above 25k)`;

            const embed = {
                title: "💰 Account Summary",
                color: 0x3498db, // Blue
                fields: [
                    { name: "Portfolio Value", value: portfolioValue, inline: true },
                    { name: "Buying Power", value: buyingPower, inline: true },
                    { name: "Day Trades", value: pdtStatus, inline: true }
                ],
                footer: { text: "Trader V3.3 • Performance Tracking" },
                timestamp: new Date().toISOString()
            };
            await this.send("", embed);
        } catch (err) {
            this.logger.error(`Discord summary error: ${err.message}`);
        }
    }
}

// ========== DATA SERVICE ==========

class DataService {
    constructor(config, logger, notifier) {
        this.alphaVKey = config.alphaVKey;
        this.finnhubToken = config.finnhubToken;
        this.logger = logger;
        this.notifier = notifier;
    }

    async getQuotes(symbols) {
        if (!symbols.length) return [];
        try {
            const quotes = await yahooFinance.quote(symbols);
            return quotes.map(q => ({
                symbol: q.symbol,
                price: q.regularMarketPrice,
                percentChange: q.regularMarketChangePercent,
                shortName: q.shortName
            }));
        } catch (err) {
            this.logger.error(`Error fetching quotes: ${err.message}`);
            return [];
        }
    }

    async getStockTwitsSentiment(symbol) {
        try {
            const res = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; TraderV3.2/1.0)',
                },
            });
            const data = await res.json();
            if (!data.messages) return 0;
            let score = 0, count = 0;
            for (const msg of data.messages) {
                if (msg.entities?.sentiment) {
                    if (msg.entities.sentiment.basic === 'Bullish') score++;
                    if (msg.entities.sentiment.basic === 'Bearish') score--;
                    count++;
                }
            }
            return count ? score / count : 0;
        } catch {
            return 0;
        }
    }

    async getHistory(symbol) {
        try {
            await sleep(12000);
            const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${this.alphaVKey}`;
            const res = await fetch(url);
            const data = await res.json();
            const series = data['Time Series (Daily)'];

            if (!series) {
                this.logger.warn(`No historical data for ${symbol}. Raw: ${JSON.stringify(data).slice(0, 200)}`);
                if (data.Note || data['Error Message']) {
                    await this.notifier.sourceFailure('AlphaVantage', data.Note || data['Error Message']);
                }
                return null;
            }

            const values = Object.values(series);
            return {
                closes: values.map(d => parseFloat(d['4. close'])).reverse(),
                highs: values.map(d => parseFloat(d['2. high'])).reverse(),
                lows: values.map(d => parseFloat(d['3. low'])).reverse(),
                opens: values.map(d => parseFloat(d['1. open'])).reverse(),
            };
        } catch (err) {
            this.logger.error(`AlphaVantage error for ${symbol}: ${err.message}`);
            await this.notifier.sourceFailure('AlphaVantage', err.message);
            return null;
        }
    }

    async getCurrentPrice(symbol) {
        try {
            const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${this.finnhubToken}`);
            const data = await res.json();
            return data.c || null;
        } catch {
            return null;
        }
    }

    async getYahooTrending() {
        try {
            const results = await yahooFinance.trendingSymbols('US');
            return results.quotes.map(q => q.symbol);
        } catch (err) {
            this.logger.error(`Yahoo Trending error: ${err.message}`);
            return [];
        }
    }

    async getFinvizMomentum() {
        const symbols = [];
        try {
            const res = await fetch(geminiAI, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                },
            });
            const html = await res.text();
            const $ = cheerio.load(html);

            $('.styled-row.is-hoverable.is-bordered.is-rounded.is-striped.has-color-text td .tab-link').each((i, e) => {
                const ticker = $(e).text().trim();
                if (ticker && !symbols.includes(ticker)) {
                    symbols.push(ticker);
                }
            });
        } catch (err) {
            this.logger.error(`Finviz scrape error: ${err.message}`);
            await this.notifier.sourceFailure('Finviz', err.message);
        }
        return symbols;
    }
}

// ========== SCREENER ==========

class Screener {
    constructor(dataService, logger, notifier) {
        this.dataService = dataService;
        this.logger = logger;
        this.notifier = notifier;
    }

    async buildUniverse() {
        this.logger.info('Building candidate universe (Yahoo + Finviz)...');

        const [yahooSymbols, finvizSymbols] = await Promise.all([
            this.dataService.getYahooTrending(),
            this.dataService.getFinvizMomentum(),
        ]);

        this.logger.info(`Yahoo returned ${yahooSymbols.length} symbols`);
        this.logger.info(`Finviz returned ${finvizSymbols.length} symbols`);

        const allSymbols = Array.from(new Set([...yahooSymbols, ...finvizSymbols]));
        this.logger.info(`Fetching quotes for ${allSymbols.length} unique symbols...`);

        const quotes = await this.dataService.getQuotes(allSymbols);
        const map = new Map();

        for (const quote of quotes) {
            const sources = [];
            if (yahooSymbols.includes(quote.symbol)) sources.push('yahoo');
            if (finvizSymbols.includes(quote.symbol)) sources.push('finviz');
            
            map.set(quote.symbol.toUpperCase(), {
                ...quote,
                sources
            });
        }

        const universe = Array.from(map.values());

        this.logger.info(`Universe size: ${universe.length}`);
        for (const u of universe) {
            this.logger.info(
                `Universe Candidate: ${u.symbol} | Price: ${u.price} | Change: ${u.percentChange}% | Sources: ${u.sources.join(', ')}`
            );
        }

        if (universe.length === 0) {
            this.logger.warn('Universe is empty — no candidates to screen.');
            await this.notifier.universeEmpty();
        }

        return universe;
    }

    computeScore(base, sentiment, rsi, macd, price, trendline) {
        const w = ScoringConfig.weights;
        let score = 0;

        if (!isNaN(base)) score += base * w.percentChange;
        if (!isNaN(sentiment)) score += sentiment * w.sentiment;
        if (rsi > 50) score += w.rsiBullish;
        if (macd > 0) score += w.macdBullish;
        if (price > trendline) score += w.trendAbove;

        return score;
    }

    async screen() {
        this.logger.info('Screening for candidates...');
        const candidates = [];
        const universe = await this.buildUniverse();

        if (universe.length === 0) {
            return [];
        }

        const limited = universe.slice(0, 8);

        for (const item of limited) {
            try {
                this.logger.info(`Analyzing ${item.symbol} (from: ${item.sources.join(', ')})`);

                const [sentiment, history] = await Promise.all([
                    this.dataService.getStockTwitsSentiment(item.symbol),
                    this.dataService.getHistory(item.symbol),
                ]);

                if (!history || history.closes.length <= 20) {
                    this.logger.warn(`Skipping ${item.symbol}: insufficient historical data`);
                    continue;
                }

                const closes = history.closes;
                const rsiArr = ti.RSI.calculate({ period: 14, values: closes });
                const rsi = rsiArr[rsiArr.length - 1] || 0;

                const macdArr = ti.MACD.calculate({
                    values: closes,
                    fastPeriod: 12,
                    slowPeriod: 26,
                    signalPeriod: 9,
                    SimpleMAOscillator: false,
                    SimpleMASignal: false,
                });
                const macd = macdArr.length ? macdArr[macdArr.length - 1].MACD : 0;

                const support = history.lows[history.lows.length - 1];
                const resistance = history.highs[history.highs.length - 1];
                const trendline = (support + resistance) / 2;

                const score = this.computeScore(
                    item.percentChange,
                    sentiment,
                    rsi,
                    macd,
                    item.price,
                    trendline
                );

                this.logger.info(
                    `Scored ${item.symbol}: score=${score.toFixed(2)}, rsi=${rsi.toFixed(2)}, macd=${macd.toFixed(2)}, trendline=${trendline.toFixed(2)}`
                );

                candidates.push({
                    ...item,
                    sentiment,
                    rsi,
                    macd,
                    score,
                    support,
                    resistance,
                    trendline,
                });
            } catch (err) {
                this.logger.error(`Error analyzing ${item.symbol}: ${err.message}`);
            }
        }

        const sorted = candidates.sort((a, b) => b.score - a.score);

        this.logger.info(`Final candidate count: ${sorted.length}`);
        for (const c of sorted) {
            this.logger.info(
                `Final Candidate: ${c.symbol} | Score: ${c.score.toFixed(2)} | Sources: ${c.sources.join(', ')}`
            );
        }

        return sorted;
    }
}

// ========== RISK MANAGER ==========

class RiskManager {
    constructor(config) {
        this.riskPerTrade = config.risk.riskPerTrade;
        this.scalpPercent = config.risk.scalpPercent;
        this.stopLossPercent = config.risk.stopLossPercent;
    }

    computeQty(portfolioValue, price) {
        const positionSize = portfolioValue * this.riskPerTrade;
        return Math.floor(positionSize / price);
    }

    computeTargets(buyPrice) {
        const target = buyPrice * (1 + this.scalpPercent);
        const stop = buyPrice * (1 - this.stopLossPercent);
        return {
            target: parseFloat(target.toFixed(2)),
            stop: parseFloat(stop.toFixed(2)),
        };
    }
}

// ========== TRADE LOGGER ==========

class TradeLogger {
    constructor(config, logger, notifier) {
        this.file = config.files.tradeLog;
        this.logger = logger;
        this.notifier = notifier;
    }

    logTrade(symbol, qty, buyPrice, exitPrice, reason) {
        const pnl = (exitPrice - buyPrice) * qty;
        const trade = {
            symbol,
            qty,
            buyPrice,
            exitPrice,
            pnl,
            reason,
            time: new Date().toISOString(),
        };

        this.logger.info(
            `Trade logged: ${symbol} | Qty: ${qty} | Buy: ${buyPrice.toFixed(2)} | Exit: ${exitPrice.toFixed(2)} | PnL: ${pnl.toFixed(2)}`
        );

        let history = [];
        if (fs.existsSync(this.file)) {
            history = JSON.parse(fs.readFileSync(this.file));
        }
        history.push(trade);
        fs.writeFileSync(this.file, JSON.stringify(history, null, 2));

        this.notifier.exit(symbol, reason, exitPrice, pnl);
    }
}

// ========== TRADE EXECUTOR ==========

class TradeExecutor {
    constructor(alpaca, riskManager, logger, notifier) {
        this.alpaca = alpaca;
        this.riskManager = riskManager;
        this.logger = logger;
        this.notifier = notifier;
    }

    async execute(stock) {
        try {
            const account = await this.alpaca.getAccount();
            const portfolioValue = parseFloat(account.portfolio_value);
            const qty = this.riskManager.computeQty(portfolioValue, stock.price);

            if (qty <= 0) {
                this.logger.warn(`Insufficient funds to buy ${stock.symbol}`);
                return null;
            }

            this.logger.success(`Buying ${qty} shares of ${stock.symbol} at ~$${stock.price.toFixed(2)}`);

            const order = await this.alpaca.createOrder({
                symbol: stock.symbol,
                qty,
                side: 'buy',
                type: 'market',
                time_in_force: 'gtc',
            });

            let filledOrder = null;
            for (let i = 0; i < 10; i++) {
                await sleep(5000);
                filledOrder = await this.alpaca.getOrder(order.id);
                if (filledOrder.status === 'filled') break;
            }

            if (!filledOrder || filledOrder.status !== 'filled') {
                this.logger.error('Order failed to fill in time.');
                return null;
            }

            const buyPrice = parseFloat(filledOrder.filled_avg_price);
            const { target, stop } = this.riskManager.computeTargets(buyPrice);

            this.logger.info(
                `Filled ${stock.symbol} @ $${buyPrice.toFixed(2)} | Target: $${target} | Stop: $${stop}`
            );

            await this.notifier.buyFilled(stock.symbol, qty, buyPrice, target, stop);

            await this.alpaca.createOrder({
                symbol: stock.symbol,
                qty,
                side: 'sell',
                type: 'stop',
                stop_price: stop,
                time_in_force: 'gtc',
            });

            return { symbol: stock.symbol, qty, buyPrice, target, stop };
        } catch (err) {
            this.logger.error(`Trade execution error: ${err.message}`);
            await this.notifier.error('TradeExecutor', err);
            return null;
        }
    }
}

// ========== POSITION MONITOR (CONCURRENT) ==========

class PositionMonitor {
    constructor(alpaca, dataService, logger, tradeLogger, notifier) {
        this.alpaca = alpaca;
        this.dataService = dataService;
        this.logger = logger;
        this.tradeLogger = tradeLogger;
        this.notifier = notifier;
        this.active = new Map(); // Map<Symbol, { data: TradeData, promise: Promise }>
    }

    startMonitor(trade) {
        const key = trade.symbol.toUpperCase();
        if (this.active.has(key)) {
            this.logger.success(`Updating monitor for ${key} with new position data.`);
            const existing = this.active.get(key);
            existing.data = { ...trade }; // Update the data that the loop is using
            return;
        }

        const monitorObj = { data: { ...trade } };
        monitorObj.promise = this.monitorPosition(monitorObj)
            .catch(err => this.logger.error(`Monitor fatal error for ${key}: ${err.message}`))
            .finally(() => this.active.delete(key));

        this.active.set(key, monitorObj);
    }

    async monitorPosition(monitorObj) {
        const symbol = monitorObj.data.symbol;
        this.logger.warn(`Monitoring ${symbol} (concurrent)...`);

        while (true) {
            await sleep(30000);

            try {
                const currentData = monitorObj.data;
                const { qty, buyPrice, target, stop } = currentData;

                if (stop === undefined) {
                    this.logger.error(`Stop price is undefined for ${symbol}. Data: ${JSON.stringify(currentData)}`);
                    // Attempt to recover stop if possible, or use a default
                    break; 
                }

                // First check if position still exists
                let position = null;
                try {
                    position = await this.alpaca.getPosition(symbol);
                } catch {
                    this.logger.warn(`${symbol} position no longer exists. Checking for external exit...`);
                    
                    // Try to find the last closed order to see how we exited
                    try {
                        const closedOrders = await this.alpaca.getOrders({
                            status: 'closed',
                            limit: 1,
                            symbols: [symbol]
                        });

                        if (closedOrders.length > 0) {
                            const lastOrder = closedOrders[0];
                            const exitPrice = parseFloat(lastOrder.filled_avg_price || lastOrder.stop_price || 0);
                            const exitQty = parseFloat(lastOrder.filled_qty || qty);
                            const reason = lastOrder.type === 'stop' ? 'Stop Loss Triggered (Alpaca)' : 'External Exit';
                            
                            this.tradeLogger.logTrade(symbol, exitQty, buyPrice, exitPrice, reason);
                        } else {
                            this.logger.warn(`Could not find closed order for ${symbol}.`);
                        }
                    } catch (orderErr) {
                        this.logger.error(`Error fetching closed orders for ${symbol}: ${orderErr.message}`);
                    }
                    break;
                }

                const currentPrice = await this.dataService.getCurrentPrice(symbol);
                if (currentPrice === null || currentPrice === undefined) {
                    this.logger.warn(`Could not fetch current price for ${symbol}. Skipping this cycle.`);
                    continue;
                }

                this.logger.info(
                    `${symbol}: $${currentPrice.toFixed(2)} (Target: $${target.toFixed(2)} / Stop: $${stop.toFixed(2)})`
                );

                // Exit Logic: Target Hit or Stop Loss Hit
                if (currentPrice >= target || currentPrice <= stop) {
                    const reason = currentPrice >= target ? 'Target Hit' : 'Stop Loss Hit';
                    this.logger.success(`${reason}! Selling ${symbol}`);
                    
                    // Surgical cancel: Only cancel orders for THIS symbol
                    try {
                        const openOrders = await this.alpaca.getOrders({ status: 'open', symbols: [symbol] });
                        for (const order of openOrders) {
                            await this.alpaca.cancelOrder(order.id);
                        }
                        if (openOrders.length > 0) await sleep(2000); 
                    } catch (err) {
                        this.logger.warn(`Order cancel failed for ${symbol}: ${err.message}`);
                    }

                    try {
                        await this.alpaca.closePosition(symbol);
                        this.tradeLogger.logTrade(symbol, qty, buyPrice, currentPrice, reason);
                        
                        const updatedAccount = await this.alpaca.getAccount();
                        await this.notifier.sendSummary(updatedAccount);
                        break; // Success, exit loop
                    } catch (err) {
                        this.logger.error(`Close position failed for ${symbol}: ${err.message}`);
                    }
                }
            } catch (err) {
                this.logger.error(`Monitor error for ${symbol}: ${err.message}`);
            }
        }
    }
}

// ========== MAIN BOT ==========

class TradingBot {
    constructor() {
        this.config = Config.load();
        this.logger = new Logger(this.config.logFile);
        this.alpaca = new Alpaca(this.config.alpaca);
        this.notifier = new DiscordNotifier(this.config, this.logger);
        this.dataService = new DataService(this.config, this.logger, this.notifier);
        this.screener = new Screener(this.dataService, this.logger, this.notifier);
        this.riskManager = new RiskManager(this.config);
        this.tradeLogger = new TradeLogger(this.config, this.logger, this.notifier);
        this.executor = new TradeExecutor(this.alpaca, this.riskManager, this.logger, this.notifier);
        this.monitor = new PositionMonitor(this.alpaca, this.dataService, this.logger, this.tradeLogger, this.notifier);
    }

    async syncPositions() {
        try {
            this.logger.info('Syncing existing positions for monitoring...');
            const positions = await this.alpaca.getPositions();
            
            for (const pos of positions) {
                const symbol = pos.symbol;
                const qty = parseFloat(pos.qty);
                const buyPrice = parseFloat(pos.avg_entry_price);
                
                // Recalculate target and stop based on the average entry price from Alpaca
                const { target, stop } = this.riskManager.computeTargets(buyPrice);

                this.logger.info(`Recovering monitor for ${symbol}: Qty ${qty}, Entry $${buyPrice.toFixed(2)}, Target $${target.toFixed(2)}, Stop $${stop.toFixed(2)}`);
                
                this.monitor.startMonitor({
                    symbol,
                    qty,
                    buyPrice,
                    target,
                    stop
                });
            }
            if (positions.length > 0) {
                this.logger.success(`Successfully recovered ${positions.length} active monitors.`);
            }
        } catch (err) {
            this.logger.error(`Failed to sync positions: ${err.message}`);
        }
    }

    async start() {
        this.logger.success('Trader V3.3 starting...');
        await this.notifier.startup();
        
        try {
            const initialAccount = await this.alpaca.getAccount();
            await this.notifier.sendSummary(initialAccount);
        } catch (err) {
            this.logger.error(`Initial summary error: ${err.message}`);
        }

        // Auto-Recovery: Pick up where we left off
        await this.syncPositions();

        while (true) {
            try {
                const clock = await this.alpaca.getClock();

                if (!clock.is_open) {
                    this.logger.error('Market is closed.');
                } else {
                    const account = await this.alpaca.getAccount();
                    const portfolioValue = parseFloat(account.portfolio_value);
                    const dayTradeCount = parseInt(account.daytrade_count);

                    // PDT Protection: If we have 3 day trades and less than 25k, do not enter new positions
                    if (portfolioValue < 25000 && dayTradeCount >= 3) {
                        this.logger.warn(`PDT GUARD: ${dayTradeCount} day trades detected on account under $25k. No new entries today.`);
                    } else {
                        const positions = await this.alpaca.getPositions();
                        if (positions.length >= this.config.risk.maxPositions) {
                            this.logger.warn('Max positions reached. Waiting...');
                        } else {
                            const candidates = await this.screener.screen();
                            if (candidates.length > 0) {
                                const slots = this.config.risk.maxPositions - positions.length;
                                const toTry = candidates.slice(0, slots * 2);

                                for (const candidate of toTry) {
                                    if (candidate.price <= candidate.trendline) {
                                        this.logger.warn(`Skipping ${candidate.symbol}, price below trendline.`);
                                        continue;
                                    }

                                    const trade = await this.executor.execute(candidate);
                                    if (trade) {
                                        this.monitor.startMonitor(trade);
                                        const updatedPositions = await this.alpaca.getPositions();
                                        if (updatedPositions.length >= this.config.risk.maxPositions) {
                                            this.logger.warn('Reached max positions after new entries.');
                                            break;
                                        }
                                    }
                                }
                            } else {
                                this.logger.warn('No candidates found this cycle.');
                            }
                        }
                    }
                }
            } catch (err) {
                this.logger.error(`Main loop error: ${err.message}`);
                await this.notifier.error('MainLoop', err);
            }

            this.logger.info(`Sleeping for ${this.config.scanIntervalMs / 60000} minutes...`);
            await sleep(this.config.scanIntervalMs);
        }
    }
}

// ========== BOOTSTRAP ==========

const bot = new TradingBot();
bot.start();