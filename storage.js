// Data layer only — no DOM. Loaded standalone by test.html, and by script.js for the UI.

const TOPICS_KEY = "research-app-topics";
const THEME_KEY = "research-app-theme";

// Research depth tiers — how many sources a "Start Research" pass tries to gather.
// Duplicated (not shared/imported) on the server side in server/server.js, since this
// workspace has no bundler/shared-module setup between browser and Node — keep both in sync.
const DEPTH_TIERS = {
  very_short: { label: "Very Short", count: 5 },
  short: { label: "Short", count: 10 },
  medium: { label: "Medium", count: 20 },
  very_indepth: { label: "Very In-Depth", count: 35 }
};

const STATUSES = ["unread", "reviewed", "important"];

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Fills in fields that didn't exist in older saved data, so a topic saved before
// a schema change still loads cleanly. Never rename/remove existing keys here.
function normalizeTopic(topic) {
  return {
    id: topic.id,
    name: topic.name,
    createdAt: topic.createdAt,
    purpose: typeof topic.purpose === "string" ? topic.purpose : "",
    seedReferences: Array.isArray(topic.seedReferences) ? topic.seedReferences : [],
    depthTier: topic.depthTier in DEPTH_TIERS ? topic.depthTier : null,
    tags: Array.isArray(topic.tags) ? topic.tags : [],
    status: STATUSES.includes(topic.status) ? topic.status : null,
    sources: Array.isArray(topic.sources) ? topic.sources : [],
    dismissedSources: Array.isArray(topic.dismissedSources) ? topic.dismissedSources : [],
    aiSummary: Array.isArray(topic.aiSummary)
      ? topic.aiSummary
      : topic.aiSummary
      ? [{ id: generateId(), text: topic.aiSummary, wordCount: null, purposeSnapshot: "", generatedAt: topic.createdAt }]
      : [],
    quiz: topic.quiz && typeof topic.quiz === "object" && !Array.isArray(topic.quiz) ? topic.quiz : null
  };
}

function loadTopics() {
  try {
    const raw = localStorage.getItem(TOPICS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTopic);
  } catch {
    return [];
  }
}

function saveTopics(topics) {
  localStorage.setItem(TOPICS_KEY, JSON.stringify(topics));
}

function addTopic(topics, name, extra = {}) {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;

  const topic = normalizeTopic({
    id: generateId(),
    name: trimmed,
    createdAt: Date.now(),
    purpose: extra.purpose,
    seedReferences: extra.seedReferences,
    depthTier: extra.depthTier
  });
  topics.push(topic);
  saveTopics(topics);
  return topic;
}

function findTopic(topics, topicId) {
  return topics.find((t) => t.id === topicId) || null;
}

function addSource(topics, topicId, title, url, meta = {}) {
  const trimmedTitle = (title || "").trim();
  const trimmedUrl = (url || "").trim();
  if (!trimmedTitle || !trimmedUrl) return null;

  const topic = findTopic(topics, topicId);
  if (!topic) return null;

  const source = {
    id: generateId(),
    title: trimmedTitle,
    url: trimmedUrl,
    addedAt: Date.now(),
    origin: meta.origin === "research" ? "research" : "manual",
    kind: meta.kind === "paper" || meta.kind === "article" ? meta.kind : null,
    abstract: typeof meta.abstract === "string" ? meta.abstract : null
  };
  topic.sources.push(source);
  saveTopics(topics);
  return source;
}

// Bulk-insert research results in one save (avoids N localStorage writes for a deep pass).
function addSourcesBulk(topics, topicId, sourceList) {
  const topic = findTopic(topics, topicId);
  if (!topic || !Array.isArray(sourceList)) return [];

  const added = [];
  for (const s of sourceList) {
    const trimmedTitle = (s.title || "").trim();
    const trimmedUrl = (s.url || "").trim();
    if (!trimmedTitle || !trimmedUrl) continue;
    const source = {
      id: generateId(),
      title: trimmedTitle,
      url: trimmedUrl,
      addedAt: Date.now(),
      origin: "research",
      kind: s.kind === "paper" || s.kind === "article" ? s.kind : null,
      abstract: typeof s.abstract === "string" ? s.abstract : null
    };
    topic.sources.push(source);
    added.push(source);
  }
  if (added.length > 0) saveTopics(topics);
  return added;
}

function deleteSource(topics, topicId, sourceId) {
  const topic = findTopic(topics, topicId);
  if (!topic) return false;

  const before = topic.sources.length;
  topic.sources = topic.sources.filter((s) => s.id !== sourceId);
  if (topic.sources.length === before) return false;

  saveTopics(topics);
  return true;
}

// Non-destructive removal: moves a source out of the active list (excluded from future
// generation) but keeps it recoverable via restoreSource.
function dismissSource(topics, topicId, sourceId) {
  const topic = findTopic(topics, topicId);
  if (!topic) return false;

  const index = topic.sources.findIndex((s) => s.id === sourceId);
  if (index === -1) return false;

  const [source] = topic.sources.splice(index, 1);
  topic.dismissedSources.push(source);
  saveTopics(topics);
  return true;
}

function restoreSource(topics, topicId, sourceId) {
  const topic = findTopic(topics, topicId);
  if (!topic) return false;

  const index = topic.dismissedSources.findIndex((s) => s.id === sourceId);
  if (index === -1) return false;

  const [source] = topic.dismissedSources.splice(index, 1);
  topic.sources.push(source);
  saveTopics(topics);
  return true;
}

function deleteTopic(topics, topicId) {
  const index = topics.findIndex((t) => t.id === topicId);
  if (index === -1) return false;

  topics.splice(index, 1);
  saveTopics(topics);
  return true;
}

function setPurpose(topics, topicId, purpose) {
  const topic = findTopic(topics, topicId);
  if (!topic) return false;
  topic.purpose = (purpose || "").trim();
  saveTopics(topics);
  return true;
}

function setDepthTier(topics, topicId, tier) {
  const topic = findTopic(topics, topicId);
  if (!topic || !(tier in DEPTH_TIERS)) return false;
  topic.depthTier = tier;
  saveTopics(topics);
  return true;
}

function setSeedReferences(topics, topicId, refs) {
  const topic = findTopic(topics, topicId);
  if (!topic) return false;
  topic.seedReferences = Array.isArray(refs) ? refs.map((r) => (r || "").trim()).filter(Boolean) : [];
  saveTopics(topics);
  return true;
}

function addTag(topics, topicId, tag) {
  const trimmed = (tag || "").trim().toLowerCase();
  if (!trimmed) return false;
  const topic = findTopic(topics, topicId);
  if (!topic) return false;
  if (topic.tags.includes(trimmed)) return false;
  topic.tags.push(trimmed);
  saveTopics(topics);
  return true;
}

function removeTag(topics, topicId, tag) {
  const topic = findTopic(topics, topicId);
  if (!topic) return false;
  const before = topic.tags.length;
  topic.tags = topic.tags.filter((t) => t !== tag);
  if (topic.tags.length === before) return false;
  saveTopics(topics);
  return true;
}

function setStatus(topics, topicId, status) {
  const topic = findTopic(topics, topicId);
  if (!topic) return false;
  if (status !== null && !STATUSES.includes(status)) return false;
  topic.status = status;
  saveTopics(topics);
  return true;
}

function countWords(text) {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Every generation is kept as a new version, not an overwrite — lets the user compare
// a summary from before/after dismissing sources.
function addSummaryVersion(topics, topicId, text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  const topic = findTopic(topics, topicId);
  if (!topic) return null;

  const version = {
    id: generateId(),
    text: trimmed,
    wordCount: countWords(trimmed),
    purposeSnapshot: topic.purpose,
    generatedAt: Date.now()
  };
  topic.aiSummary.push(version);
  saveTopics(topics);
  return version;
}

function setQuiz(topics, topicId, questions) {
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const topic = findTopic(topics, topicId);
  if (!topic) return null;

  const quiz = { questions, generatedAt: Date.now() };
  topic.quiz = quiz;
  saveTopics(topics);
  return quiz;
}
