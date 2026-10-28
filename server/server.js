const express = require("express");
const path = require("path");
const config = require("./lib/config");
const gemini = require("./lib/gemini");
const semanticScholar = require("./lib/semanticScholar");
const extract = require("./lib/extract");

// Resolves Gemini grounding's opaque redirect links + bare-domain titles to real
// article URLs/titles, a few at a time so we don't hammer a dozen sites at once.
async function resolveArticles(articles) {
  const results = new Array(articles.length);
  let cursor = 0;
  async function worker() {
    while (cursor < articles.length) {
      const index = cursor++;
      const article = articles[index];
      const meta = await extract.resolveArticleMeta(article.url);
      results[index] = { ...article, url: meta.url, title: meta.title || article.title };
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, articles.length) }, worker));
  return results;
}
const { createJob, updateJob, getJob } = require("./lib/jobs");

const PORT = process.env.PORT || 8794;
const APP_ROOT = path.join(__dirname, "..");

// Same duplication note as storage.js: no shared-module setup between browser and
// Node in this workspace, so these must be kept in sync by hand.
const DEPTH_TIERS = {
  very_short: { count: 5 },
  short: { count: 10 },
  medium: { count: 20 },
  very_indepth: { count: 35 }
};

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---------- Settings ----------

app.get("/api/settings", (req, res) => {
  const { geminiApiKey, tier } = config.getConfig();
  res.json({ hasKey: Boolean(geminiApiKey), tier });
});

app.post("/api/settings/key", (req, res) => {
  const { apiKey, tier } = req.body || {};
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return res.status(400).json({ error: "apiKey is required" });
  }
  const saved = config.setConfig({ geminiApiKey: apiKey, tier });
  res.json({ hasKey: Boolean(saved.geminiApiKey), tier: saved.tier });
});

app.get("/api/usage", (req, res) => {
  res.json(config.getUsage());
});

// ---------- Lifecycle: shut down when no tab is left open ----------
//
// Chrome's --app= mode doesn't give the launcher a reliable "this window closed"
// signal once other Chrome windows exist, so the frontend instead pings here every
// few seconds while it's open, and explicitly signals on tab teardown via "pagehide".
// The catch: pagehide also fires on a plain refresh/navigation, not just a real close
// — a naive "shut down the instant this fires" would kill the server every time the
// user hits F5. So a shutdown signal only takes effect if no heartbeat arrives in the
// following grace window; a refresh's new page loads and starts heartbeating again
// well within that window, which cancels it. A real close never sends another
// heartbeat, so it goes through — that's the primary, near-instant path. The
// no-heartbeat-at-all timeout below is only a backstop for whatever misses even
// that (a hard browser crash, network blip). It must stay generous: Chrome heavily
// throttles setInterval in backgrounded/minimized tabs (confirmed while testing —
// a tab that was merely hidden, not closed, missed its 8s heartbeat badly enough to
// trip a 20s timeout). A user alt-tabbing away while a long research/summary job
// runs is normal, expected usage, not a close — this must not punish that.

const HEARTBEAT_TIMEOUT_MS = 90000;
const SHUTDOWN_GRACE_MS = 3000;
let lastHeartbeat = Date.now();

app.post("/api/heartbeat", (req, res) => {
  lastHeartbeat = Date.now();
  res.json({ ok: true });
});

app.post("/api/shutdown", (req, res) => {
  res.json({ ok: true });
  const requestedAt = Date.now();
  setTimeout(() => {
    if (lastHeartbeat < requestedAt) {
      console.log("Tab closed — shutting down.");
      process.exit(0);
    }
  }, SHUTDOWN_GRACE_MS);
});

setInterval(() => {
  if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
    console.log("No heartbeat received — shutting down.");
    process.exit(0);
  }
}, 5000).unref();

// ---------- Research (find papers + articles) ----------

async function runResearchJob(jobId, { name, purpose, seedReferences, depthTier }) {
  try {
    const total = DEPTH_TIERS[depthTier]?.count ?? DEPTH_TIERS.medium.count;
    updateJob(jobId, { progress: { stage: "Deciding paper vs. article balance…", found: 0, total } });

    const { paperRatio } = await gemini.classifyResearchMix({ name, purpose, seedReferences });
    const paperCount = Math.round(total * paperRatio);
    let articleCount = total - paperCount;

    let found = [];

    // Semantic Scholar's unauthenticated pool is shared across every user of the API
    // and can be rate-limited or come up short for reasons unrelated to this search —
    // any shortfall here is made up by article search below, not left as a gap.
    if (paperCount > 0) {
      updateJob(jobId, { progress: { stage: `Searching academic papers (target ${paperCount})…` } });
      const papers = await semanticScholar.findPapers({ name, purpose, seedReferences, count: paperCount });
      found = found.concat(papers);
      articleCount += paperCount - papers.length;
      updateJob(jobId, { progress: { found: found.length } });
    }

    if (articleCount > 0) {
      updateJob(jobId, { progress: { stage: `Searching web articles (target ${articleCount})…` } });
      const rawArticles = await gemini.searchArticles({ name, purpose, count: articleCount });
      updateJob(jobId, { progress: { stage: "Resolving article links…" } });
      const articles = await resolveArticles(rawArticles);
      found = found.concat(articles);
      updateJob(jobId, { progress: { found: found.length } });
    }

    // Final safety net: if articles also came up short (e.g. grounding returned fewer
    // chunks than asked), try papers once more for whatever's still missing.
    if (found.length < total) {
      const shortfall = total - found.length;
      updateJob(jobId, { progress: { stage: `Topping up (${shortfall} more needed)…` } });
      const extraPapers = await semanticScholar.findPapers({ name, purpose, seedReferences, count: shortfall });
      const existingUrls = new Set(found.map((s) => s.url));
      for (const p of extraPapers) {
        if (!existingUrls.has(p.url)) found.push(p);
      }
      updateJob(jobId, { progress: { found: found.length } });
    }

    updateJob(jobId, {
      status: "done",
      progress: { stage: `Found ${found.length} of ${total} targeted sources`, found: found.length },
      result: { sources: found }
    });
  } catch (err) {
    updateJob(jobId, { status: "error", error: err.message || "Research failed" });
  }
}

app.post("/api/topics/:id/research", (req, res) => {
  const { name, purpose, seedReferences, depthTier } = req.body || {};
  if (!name || !depthTier || !(depthTier in DEPTH_TIERS)) {
    return res.status(400).json({ error: "name and a valid depthTier are required" });
  }
  const job = createJob("research", req.params.id);
  res.status(202).json({ jobId: job.id });
  runResearchJob(job.id, { name, purpose: purpose || "", seedReferences: seedReferences || [], depthTier });
});

// ---------- Summary generation ----------

async function extractWithConcurrency(sources, jobId) {
  const results = new Array(sources.length);
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < sources.length) {
      const index = cursor++;
      const source = sources[index];
      const extracted = await extract.extractPageText(source.url);
      results[index] = {
        title: source.title,
        url: source.url,
        kind: source.kind,
        text: extracted?.text || null,
        abstract: source.abstract || null
      };
      done++;
      updateJob(jobId, { progress: { stage: `Reading source ${done} of ${sources.length}…`, found: done, total: sources.length } });
    }
  }

  const workers = Array.from({ length: Math.min(4, sources.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function runSummaryJob(jobId, { name, purpose, sources }) {
  try {
    updateJob(jobId, { progress: { stage: `Reading 0 of ${sources.length}…`, found: 0, total: sources.length } });
    const sourcesWithText = await extractWithConcurrency(sources, jobId);

    updateJob(jobId, { progress: { stage: "Writing summary…" } });
    const text = await gemini.generateSummary({ name, purpose, sources: sourcesWithText });

    updateJob(jobId, { status: "done", progress: { stage: "Done" }, result: { text } });
  } catch (err) {
    updateJob(jobId, { status: "error", error: err.message || "Summary generation failed" });
  }
}

app.post("/api/topics/:id/generate-summary", (req, res) => {
  const { name, purpose, sources } = req.body || {};
  if (!name || !Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ error: "name and at least one source are required" });
  }
  const job = createJob("summary", req.params.id);
  res.status(202).json({ jobId: job.id });
  runSummaryJob(job.id, { name, purpose: purpose || "", sources });
});

// ---------- Quiz generation ----------

async function runQuizJob(jobId, { name, purpose, summaryText }) {
  try {
    updateJob(jobId, { progress: { stage: "Writing quiz…" } });
    const questions = await gemini.generateQuiz({ name, purpose, summaryText });
    updateJob(jobId, { status: "done", progress: { stage: "Done" }, result: { questions } });
  } catch (err) {
    updateJob(jobId, { status: "error", error: err.message || "Quiz generation failed" });
  }
}

app.post("/api/topics/:id/generate-quiz", (req, res) => {
  const { name, purpose, summaryText } = req.body || {};
  if (!name || !summaryText) {
    return res.status(400).json({ error: "name and summaryText are required" });
  }
  const job = createJob("quiz", req.params.id);
  res.status(202).json({ jobId: job.id });
  runQuizJob(job.id, { name, purpose: purpose || "", summaryText });
});

// ---------- Jobs ----------

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

// ---------- Static frontend ----------

app.use(express.static(APP_ROOT));

app.listen(PORT, () => {
  console.log(`Research App server running at http://localhost:${PORT}`);
});
