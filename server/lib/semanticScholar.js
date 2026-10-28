// No API key required — uses Semantic Scholar's public, shared-rate-limit endpoints.
// That shared pool can be slow or occasionally 429 under load, so every call here is
// best-effort with a short timeout and silent fallback, never a hard failure for the
// caller — a research pass should degrade gracefully, not blow up because one paper
// lookup was slow.

const GRAPH_BASE = "https://api.semanticscholar.org/graph/v1";
const REC_BASE = "https://api.semanticscholar.org/recommendations/v1";
const FIELDS = "title,abstract,url,externalIds";

const ARXIV_RE = /arxiv\.org\/(?:abs|pdf)\/([\w.\-]+?)(?:v\d+)?(?:\.pdf)?(?:[?#]|$)/i;
const DOI_RE = /(?:doi\.org\/|^|\/)(10\.\d{4,9}\/[^\s"'<>]+)/i;

async function fetchJson(url, options = {}, retriesOn429 = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (res.status === 429 && retriesOn429 > 0) {
      clearTimeout(timeout);
      await new Promise((r) => setTimeout(r, 1500));
      return fetchJson(url, options, retriesOn429 - 1);
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Turns a seed reference (URL or free-text title) into a Semantic Scholar paperId.
async function resolveSeedToPaperId(seedRef) {
  const arxivMatch = seedRef.match(ARXIV_RE);
  if (arxivMatch) {
    const paper = await fetchJson(`${GRAPH_BASE}/paper/ARXIV:${arxivMatch[1]}?fields=paperId`);
    if (paper?.paperId) return paper.paperId;
  }

  const doiMatch = seedRef.match(DOI_RE);
  if (doiMatch) {
    const paper = await fetchJson(`${GRAPH_BASE}/paper/DOI:${encodeURIComponent(doiMatch[1])}?fields=paperId`);
    if (paper?.paperId) return paper.paperId;
  }

  // Fall back to a text search — works for plain titles and for URLs we can't
  // resolve directly (use the last path segment or the whole string as the query).
  const query = /^https?:\/\//i.test(seedRef)
    ? decodeURIComponent(seedRef.split("/").filter(Boolean).pop() || seedRef).replace(/[-_]/g, " ")
    : seedRef;
  const search = await fetchJson(`${GRAPH_BASE}/paper/search?query=${encodeURIComponent(query)}&limit=1&fields=paperId`);
  return search?.data?.[0]?.paperId || null;
}

async function getRecommendations(positiveIds, count) {
  if (positiveIds.length === 0) return [];
  const result = await fetchJson(`${REC_BASE}/papers/?fields=${FIELDS}&limit=${count}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positivePaperIds: positiveIds })
  });
  return result?.recommendedPapers || [];
}

async function searchPapers(query, count) {
  const result = await fetchJson(`${GRAPH_BASE}/paper/search?query=${encodeURIComponent(query)}&limit=${count}&fields=${FIELDS}`);
  return result?.data || [];
}

function toSource(paper) {
  const url = paper.url || (paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : null);
  if (!url || !paper.title) return null;
  return { title: paper.title, url, abstract: paper.abstract || null, kind: "paper" };
}

// Main entry point: resolves the user's seed references to real papers, asks Semantic
// Scholar for similar work via its recommendation graph, and tops up with a plain
// search if recommendations come up short (e.g. no seeds were given or resolvable).
async function findPapers({ name, purpose, seedReferences, count }) {
  if (count <= 0) return [];

  const seedIds = (await Promise.all(seedReferences.map(resolveSeedToPaperId))).filter(Boolean);

  let papers = [];
  if (seedIds.length > 0) {
    papers = await getRecommendations(seedIds, count);
  }

  if (papers.length < count) {
    const query = [name, purpose].filter(Boolean).join(" — ");
    const fallback = await searchPapers(query, count - papers.length);
    const existingUrls = new Set(papers.map((p) => p.url));
    for (const p of fallback) {
      if (!existingUrls.has(p.url)) papers.push(p);
    }
  }

  return papers.map(toSource).filter(Boolean).slice(0, count);
}

module.exports = { findPapers };
