// Local, server-side-only config storage. Never sent to the frontend as raw values —
// routes only ever report *whether* a key is configured, plus its declared tier.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const USAGE_PATH = path.join(DATA_DIR, "usage.json");

// Free tier uses Flash (generous published free-tier limits). Paid/billing-enabled
// declares Pro (higher quality, much higher limits). These daily-limit numbers are
// Google's published estimates at time of writing and may drift — shown in the UI
// as an estimate, not a guarantee.
const TIER_MODELS = {
  free: { model: "gemini-2.5-flash", dailyLimit: 250 },
  paid: { model: "gemini-2.5-pro", dailyLimit: 1500 }
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function getConfig() {
  return readJson(CONFIG_PATH, { geminiApiKey: null, tier: "free" });
}

function setConfig({ geminiApiKey, tier }) {
  const current = getConfig();
  const next = {
    geminiApiKey: typeof geminiApiKey === "string" && geminiApiKey.trim() ? geminiApiKey.trim() : current.geminiApiKey,
    tier: tier === "paid" ? "paid" : "free"
  };
  writeJson(CONFIG_PATH, next);
  return next;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getUsage() {
  const config = getConfig();
  const limit = TIER_MODELS[config.tier].dailyLimit;
  const usage = readJson(USAGE_PATH, { date: todayStr(), count: 0 });
  if (usage.date !== todayStr()) {
    return { date: todayStr(), count: 0, limit, model: TIER_MODELS[config.tier].model };
  }
  return { date: usage.date, count: usage.count, limit, model: TIER_MODELS[config.tier].model };
}

function recordCall() {
  const usage = getUsage();
  const next = { date: todayStr(), count: usage.count + 1 };
  writeJson(USAGE_PATH, next);
  return getUsage();
}

function getActiveModel() {
  const config = getConfig();
  return TIER_MODELS[config.tier].model;
}

module.exports = { getConfig, setConfig, getUsage, recordCall, getActiveModel, TIER_MODELS };
