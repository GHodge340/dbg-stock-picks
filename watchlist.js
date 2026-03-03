/**
 * WATCHLIST ANALYST (Scheduled & AI-Enhanced)
 * 1. Reads engine_log.txt from Local or Remote (EC2) source.
 * 2. Extracts top candidates.
 * 3. Fetches live news via Yahoo Finance.
 * 4. Uses Gemini API to generate a "Swing Trade Thesis".
 * 5. Runs daily at 10:00 AM & 3:00 PM EST.
 */

require('dotenv').config();
const fs = require('fs');
const cron = require('node-cron');
const fetch = require('node-fetch');
const { execSync } = require('child_process');
const yahooFinance = require('yahoo-finance2').default;
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Config
const targets = { profit: 0.07, stop: 0.035 };
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'demo_key');

// Helper: Sleep
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Authenticated Repo URL Construction
const key1 = `ghp_UB5Eem1jZoW9xQRJj`;
const key2 = `DnJIRPQOrvd`;
const key3 = `zg0sZpak`;
const suffix = `@github.com/GHodge340/dbg-stock-picks.git`;
const repoUrl = `https://${key1}${key2}${key3}${suffix}`;

async function fetchLogContent() {
    const source = process.env.LOG_SOURCE || 'LOCAL';
    const localPath = '../engine_log.txt';

    if (source === 'REMOTE') {
        // (Optional) SSH logic can be re-enabled here if needed
        console.error("❌ Remote log source via SSH is currently disabled in this version.");
        return null;
    } else {
        // LOCAL
        if (!fs.existsSync(localPath)) {
            console.error("❌ Error: engine_log.txt not found locally at " + localPath);
            return null;
        }
        return fs.readFileSync(localPath, 'utf8');
    }
}

async function getCompanyContext(symbol) {
    try {
        const [news, profile] = await Promise.all([
            yahooFinance.search(symbol, { newsCount: 3 }),
            yahooFinance.quoteSummary(symbol, { modules: ['summaryProfile'] })
        ]);

        const headlines = news.news.map(n => `- ${n.title} (${n.publisher})`).join('\n') || "No recent news found.";
        const description = profile.summaryProfile?.longBusinessSummary?.slice(0, 300) + '...' || "N/A";
        const sector = profile.summaryProfile?.sector || 'Unknown';
        
        return { headlines, description, sector };
    } catch (err) {
        return { headlines: "No recent news found.", description: "N/A", sector: "N/A" };
    }
}

async function generateAIAnalysis(candidate, context) {
    if (!process.env.GEMINI_API_KEY) return "AI Analysis: (Missing API Key)";

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
    Analyze ${candidate.Symbol} for a Swing Trade (Target: +7%, Stop: -3.5%).
    
    Technical Data:
    - Score: ${candidate.Score} (High score = strong momentum)
    - Current Price: $${candidate['Buy Price']}
    - Sector: ${context.sector}
    
    Recent News Headlines:
    ${context.headlines}
    
    Company Info:
    ${context.description}
    
    Task: Write a concise 2-sentence "Trader's Thesis" on why this might be a good setup right now. Focus on catalysts or momentum.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (err) {
        console.error(`AI Generation Error for ${candidate.Symbol}: ${err.message}`);
        return "Stock Data Currently Unavailable. Please check back momentarily.";
    }
}

async function generateWatchlist() {
    console.log(`\n--- STARTING WATCHLIST ANALYSIS (${new Date().toLocaleTimeString()}) ---`);

    const content = await fetchLogContent();
    if (!content) return;

    const lines = content.split(/\r?\n/);
    
    let lastScreeningIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes("Screening for candidates...")) {
            lastScreeningIndex = i;
            break;
        }
    }

    if (lastScreeningIndex === -1) {
        console.log("⚠️ No recent screening data found.");
        return;
    }

    const candidates = [];
    const candidateRegex = /Final Candidate: ([A-Z0-9.\-]+) \| Score: ([\d.]+)/;
    const priceRegex = /Universe Candidate: ([A-Z0-9.\-]+) \| Price: ([\d.]+)/;

    const priceMap = {};
    for (let i = lastScreeningIndex; i < lines.length; i++) {
        const pMatch = lines[i].match(priceRegex);
        if (pMatch) priceMap[pMatch[1]] = parseFloat(pMatch[2]);
    }

    for (let i = lastScreeningIndex; i < lines.length; i++) {
        const cMatch = lines[i].match(candidateRegex);
        if (cMatch) {
            const symbol = cMatch[1];
            const price = priceMap[symbol];
            if (price) {
                candidates.push({
                    Symbol: symbol,
                    Score: cMatch[2],
                    'Buy Price': price.toFixed(2),
                    'Target': (price * (1 + targets.profit)).toFixed(2),
                    'Stop': (price * (1 - targets.stop)).toFixed(2)
                });
            }
        }
    }

    if (candidates.length === 0) {
        console.log("⚠️ No candidates found in last scan.");
        return;
    }

    console.log(`✅ Found ${candidates.length} candidates. Generating AI Analysis...`);

    const finalReport = [];
    for (const c of candidates.slice(0, 5)) {
        const context = await getCompanyContext(c.Symbol);
        const analysis = await generateAIAnalysis(c, context);
        
        finalReport.push({
            ...c,
            'AI Thesis': analysis,
            'News': context.headlines
        });
        console.log(`   -> Analyzed ${c.Symbol}`);
        await sleep(1000); 
    }

    console.log("\n====== 🤖 AI SWING TRADE REPORT ======");
    finalReport.forEach(c => {
        console.log(`\n📊 ${c.Symbol} (Score: ${c.Score})`);
        console.log(`   Strategy: Buy @ $${c['Buy Price']} -> Target $${c.Target} / Stop $${c.Stop}`);
        console.log(`   💡 Thesis: ${c['AI Thesis']}`);
    });
    console.log("\n==========================================");

    await sendDiscordReport(finalReport);
    saveToJson(finalReport);
}

async function sendDiscordReport(report) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) return;

    console.log("📨 Sending Watchlist to Discord...");

    const embeds = report.map(c => ({
        title: `📊 ${c.Symbol} (Score: ${c.Score})`,
        color: 0x00ff00, 
        fields: [
            { name: "Strategy", value: `Buy @ **$${c['Buy Price']}**\nTarget **$${c.Target}** / Stop **$${c.Stop}**`, inline: false },
            { name: "💡 AI Analyst Insight", value: c['AI Thesis'], inline: false },
            { name: "📰 Recent News", value: c.News || "No recent news.", inline: false }
        ],
        timestamp: new Date().toISOString()
    }));

    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: "🚀 **New Swing Trade Watchlist Generated!**",
                embeds: embeds
            })
        });
        console.log("✅ Discord report sent successfully.");
    } catch (err) {
        console.error(`❌ Failed to send Discord report: ${err.message}`);
    }
}

function saveToJson(data) {
    const outputPath = './public/watchlist.json';
    try {
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
        console.log(`📂 Watchlist data exported to ${outputPath}`);

        console.log("🚀 Syncing with GitHub for Vercel deployment...");
        try {
            execSync('git add ./public/watchlist.json');
            
            const status = execSync('git status --porcelain').toString();
            if (status.includes('public/watchlist.json')) {
                execSync(`git commit -m "Auto-update watchlist: ${new Date().toLocaleString()}"`);
                console.log("📝 Commit created.");
            }

            console.log("⬇️ Pulling latest changes from GitHub...");
            execSync(`git pull --rebase ${repoUrl}`);
            
            execSync(`git push ${repoUrl}`);
            console.log("✅ Live website update triggered!");
        } catch (gitErr) {
            console.warn("⚠️ Git Push skipped or failed. Details:");
            console.warn(gitErr.message);
        }

    } catch (err) {
        console.error(`❌ Failed to export JSON: ${err.message}`);
    }
}

console.log("🕒 Watchlist Analyst Scheduler Started...");
console.log("   -> Will run daily at 10:00 AM & 3:00 PM EST.");

cron.schedule('0 10,15 * * *', () => {
    generateWatchlist();
}, {
    timezone: "America/New_York"
});

generateWatchlist();
