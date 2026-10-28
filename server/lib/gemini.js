const { GoogleGenAI, Type } = require("@google/genai");
const { getConfig, getActiveModel, recordCall } = require("./config");

function client() {
  const { geminiApiKey } = getConfig();
  if (!geminiApiKey) {
    const err = new Error("No Gemini API key configured. Add one via the Settings popup.");
    err.code = "NO_API_KEY";
    throw err;
  }
  return new GoogleGenAI({ apiKey: geminiApiKey });
}

function isTransient(err) {
  const msg = err.message || "";
  return /"code":\s*(429|503)/.test(msg) || /UNAVAILABLE|RESOURCE_EXHAUSTED/.test(msg);
}

// Gemini's shared free-tier infrastructure occasionally returns transient 429/503s
// under load — retried with backoff rather than surfaced as a hard failure, since a
// single blip shouldn't sink an entire research/summary/quiz pass.
async function generateContent(params, attempt = 0) {
  const ai = client();
  const model = getActiveModel();
  try {
    const result = await ai.models.generateContent({ model, ...params });
    recordCall();
    return result;
  } catch (err) {
    if (isTransient(err) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      return generateContent(params, attempt + 1);
    }
    throw err;
  }
}

// Decides how much of the research budget should go to academic papers vs.
// general web articles, based on the topic's purpose and any seed reference domains.
async function classifyResearchMix({ name, purpose, seedReferences }) {
  const prompt = `You are deciding the search strategy for a research assistant tool.

Topic name: ${name}
Stated purpose (why the user wants this researched): ${purpose || "(not given)"}
Seed references the user already has: ${seedReferences.length ? seedReferences.join(", ") : "(none given)"}

Decide what fraction of sources should be formal academic research papers vs. general
web articles (news, blog posts, guides, industry reports, etc.). A topic like
theoretical physics should skew heavily toward papers. A topic like "YouTube channel
growth strategies" should skew heavily toward articles, since that isn't academic
research paper territory. Use the seed reference domains as a strong signal if given
(e.g. arxiv.org/doi.org links imply papers).

Respond with your decision.`;

  try {
    const response = await generateContent({
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            paperRatio: { type: Type.NUMBER, description: "0.0 to 1.0, fraction of sources that should be academic papers" },
            reasoning: { type: Type.STRING }
          },
          required: ["paperRatio", "reasoning"]
        },
        maxOutputTokens: 512
      }
    });
    const parsed = JSON.parse(response.text);
    const ratio = Math.max(0, Math.min(1, Number(parsed.paperRatio)));
    return { paperRatio: Number.isFinite(ratio) ? ratio : 0.5, reasoning: parsed.reasoning || "" };
  } catch {
    // Fall back to an even split if classification fails for any reason — never block research.
    return { paperRatio: 0.5, reasoning: "Classification unavailable — defaulted to an even split." };
  }
}

// Uses Gemini's Google Search grounding to find general web articles. Grounding can't
// be combined with structured JSON output, so results come from groundingChunks, not
// a parsed JSON body — count is best-effort, not guaranteed.
async function searchArticles({ name, purpose, count }) {
  if (count <= 0) return [];
  const prompt = `Search the web and find up to ${count} high-quality, relevant articles
(news, blog posts, guides, industry writeups — not academic papers) about:

Topic: ${name}
Purpose: ${purpose || "general understanding of the topic"}

Prioritize recent, credible, substantive sources directly relevant to the stated purpose.`;

  try {
    const response = await generateContent({
      contents: prompt,
      config: { tools: [{ googleSearch: {} }], maxOutputTokens: 1024 }
    });
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const seen = new Set();
    const results = [];
    for (const chunk of chunks) {
      const uri = chunk.web?.uri;
      const title = chunk.web?.title;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      results.push({ title: title || uri, url: uri, kind: "article" });
      if (results.length >= count) break;
    }
    return results;
  } catch (err) {
    console.error("searchArticles failed:", err.message);
    return [];
  }
}

// sources: [{ title, url, kind, text|abstract }] — text is the extracted page content
// (or the abstract, when full-text extraction failed) fed to the model as context.
async function generateSummary({ name, purpose, sources }) {
  const sourceBlocks = sources
    .map((s, i) => {
      const body = s.text || s.abstract || "(content unavailable — summarize from title/URL context only)";
      return `[Source ${i + 1}] ${s.title} (${s.url})\n${body.slice(0, 12000)}`;
    })
    .join("\n\n---\n\n");

  const prompt = `Write a comprehensive research summary on the topic below, synthesizing
every source provided. Do not just summarize each source separately — produce one
coherent narrative that serves the user's stated purpose.

Topic: ${name}
Purpose (the summary must be coherent with and useful for this specific purpose): ${purpose || "general understanding of the topic"}

Target length: at least 2000 words. Prioritize accuracy and genuine substance over
padding — if the provided sources don't support 2000 words of real content, write as
much substantive material as the sources support and say so plainly at the end rather
than inventing filler.

Sources:

${sourceBlocks}

Write the summary now, in clear prose with section headings where useful. Output
plain text only — no Markdown syntax (no #, ##, **, *, -, or similar). For a section
heading, put it alone on its own line in Title Case followed by a blank line. The
frontend displays this as plain text, so any markup characters would show up literally
to the user.`;

  const response = await generateContent({
    contents: prompt,
    config: { maxOutputTokens: 8192 }
  });
  return response.text || "";
}

async function generateQuiz({ name, purpose, summaryText }) {
  const prompt = `Based on the research summary below, write 8 quiz questions to check
understanding of the material, tailored to this purpose: ${purpose || "general understanding"}.
Mix multiple-choice (4 options) and short-answer questions. Plain text only in every
field — no Markdown syntax (no **, *, #, etc.), since the frontend displays these as
plain text.

Topic: ${name}

Summary:
${summaryText.slice(0, 20000)}`;

  const response = await generateContent({
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Empty array for short-answer questions" },
            answer: { type: Type.STRING }
          },
          required: ["question", "answer"]
        }
      },
      maxOutputTokens: 2048
    }
  });
  const parsed = JSON.parse(response.text);
  return Array.isArray(parsed) ? parsed : [];
}

module.exports = { classifyResearchMix, searchArticles, generateSummary, generateQuiz };
