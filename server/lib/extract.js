// Best-effort server-side page-content extraction. Many sites block bots, sit behind
// paywalls, or render via client-side JS this fetch can't execute — failure here is
// expected and normal, not a bug. Callers must degrade gracefully (fall back to
// title/abstract) rather than treat a null return as an error.

const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");

async function extractPageText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("html")) return null;

    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article?.textContent) return null;

    return { title: article.title || null, text: article.textContent.trim() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i;

// Gemini's Google Search grounding returns opaque vertexaisearch.cloud.google.com
// redirect links and bare-domain titles (e.g. "nih.gov") instead of real article
// titles/URLs. This follows the redirect to the real destination and pulls the
// page's actual <title> — a cheap partial fetch, not a full Readability parse.
async function resolveArticleMeta(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" }
    });
    const finalUrl = res.url || url;
    if (!res.ok) return { url: finalUrl, title: null };
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("html")) return { url: finalUrl, title: null };
    const html = await res.text();
    const match = html.match(TITLE_RE);
    const title = match ? match[1].trim().replace(/\s+/g, " ") : null;
    return { url: finalUrl, title: title || null };
  } catch {
    return { url, title: null };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { extractPageText, resolveArticleMeta };
