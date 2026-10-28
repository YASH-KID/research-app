let topics = loadTopics();
let pendingDelete = null; // { type: "topic" | "source", topicId, sourceId? }
let searchQuery = "";
let statusFilterValue = "";
let tagFilterValue = "";
const activeJobs = {}; // topicId -> { research?: jobId, summary?: jobId, quiz?: jobId }
const dismissedOpen = new Set(); // topicIds whose "Dismissed" section is expanded
let usage = null;

const addTopicForm = document.getElementById("addTopicForm");
const topicNameInput = document.getElementById("topicNameInput");
const topicPurposeInput = document.getElementById("topicPurposeInput");
const topicSeedsInput = document.getElementById("topicSeedsInput");
const topicDepthInput = document.getElementById("topicDepthInput");
const topicsContainer = document.getElementById("topicsContainer");
const emptyState = document.getElementById("emptyState");

const searchInput = document.getElementById("searchInput");
const statusFilter = document.getElementById("statusFilter");
const tagFilter = document.getElementById("tagFilter");

const confirmOverlay = document.getElementById("confirmOverlay");
const confirmMessage = document.getElementById("confirmMessage");
const confirmCancel = document.getElementById("confirmCancel");
const confirmOk = document.getElementById("confirmOk");

const themeToggle = document.getElementById("themeToggle");

const settingsToggle = document.getElementById("settingsToggle");
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsStatus = document.getElementById("settingsStatus");
const settingsKeyInput = document.getElementById("settingsKeyInput");
const settingsCancel = document.getElementById("settingsCancel");
const settingsSave = document.getElementById("settingsSave");

const usageCounter = document.getElementById("usageCounter");

const URL_SCHEME_RE = /^https?:\/\//i;
const SOURCE_KIND_ICON = { paper: "📄", article: "🌐" };

// ---------- API helpers ----------

async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `POST ${path} failed`);
  }
  return res.json();
}

function pollJob(jobId, { onProgress, onDone, onError }) {
  const tick = async () => {
    let job;
    try {
      job = await apiGet(`/api/jobs/${jobId}`);
    } catch {
      onError("Lost contact with the server.");
      return;
    }
    if (job.progress) onProgress(job.progress);
    if (job.status === "done") {
      onDone(job.result);
      refreshUsage();
    } else if (job.status === "error") {
      onError(job.error || "Something went wrong.");
      refreshUsage();
    } else {
      setTimeout(tick, 1500);
    }
  };
  tick();
}

async function refreshUsage() {
  try {
    usage = await apiGet("/api/usage");
    renderUsage();
  } catch {
    // Usage counter is a nicety — a failed refresh just leaves the last known value showing.
  }
}

function renderUsage() {
  if (!usage) return;
  usageCounter.textContent = `${usage.count}/${usage.limit}`;
  usageCounter.title = `${usage.count} of an estimated ${usage.limit} Gemini calls used today (${usage.model})`;
}

// ---------- Depth tier options ----------

function populateDepthSelect() {
  topicDepthInput.innerHTML = "";
  for (const [key, tier] of Object.entries(DEPTH_TIERS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${tier.label} (~${tier.count} sources)`;
    topicDepthInput.appendChild(opt);
  }
  topicDepthInput.value = "short";
}

// ---------- Filtering ----------

function matchesFilters(topic) {
  if (statusFilterValue && topic.status !== statusFilterValue) return false;
  if (tagFilterValue && !topic.tags.includes(tagFilterValue)) return false;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    const inTopic = topic.name.toLowerCase().includes(q) || topic.purpose.toLowerCase().includes(q);
    const inSources = topic.sources.some((s) => s.title.toLowerCase().includes(q) || s.url.toLowerCase().includes(q));
    const inTags = topic.tags.some((t) => t.includes(q));
    if (!inTopic && !inSources && !inTags) return false;
  }
  return true;
}

function rebuildTagFilterOptions() {
  const allTags = new Set();
  for (const t of topics) for (const tag of t.tags) allTags.add(tag);
  const current = tagFilter.value;
  tagFilter.innerHTML = '<option value="">All tags</option>';
  for (const tag of Array.from(allTags).sort()) {
    const opt = document.createElement("option");
    opt.value = tag;
    opt.textContent = tag;
    tagFilter.appendChild(opt);
  }
  if (allTags.has(current)) tagFilter.value = current;
  else tagFilterValue = "";
}

// ---------- Rendering ----------

function cardRotation(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const normalized = ((Math.abs(hash) % 240) / 240) * 2.4 - 1.2; // -1.2deg .. 1.2deg
  return normalized.toFixed(2);
}

function renderTopics() {
  rebuildTagFilterOptions();
  topicsContainer.innerHTML = "";
  const visible = topics.filter(matchesFilters);
  emptyState.style.display = visible.length === 0 ? "block" : "none";
  emptyState.textContent =
    topics.length === 0
      ? "No research topics yet — add one above to get started."
      : "No topics match your search/filters.";
  for (const topic of visible) {
    topicsContainer.appendChild(buildTopicCard(topic));
  }
  attachMicButtons();
}

function buildTopicCard(topic) {
  const card = document.createElement("div");
  card.className = "topic-card";
  card.dataset.topicId = topic.id;
  card.style.setProperty("--card-rotate", `${cardRotation(topic.id)}deg`);
  card.style.transform = `rotate(var(--card-rotate))`;

  const inner = document.createElement("div");
  inner.className = "topic-card-inner";

  inner.appendChild(buildTopicHeader(topic));
  inner.appendChild(buildTopicMeta(topic));
  inner.appendChild(buildResearchRow(topic));

  if (topic.sources.length > 0) {
    const list = document.createElement("ul");
    list.className = "source-list";
    for (const source of topic.sources) list.appendChild(buildSourceItem(topic, source));
    inner.appendChild(list);
  } else {
    const empty = document.createElement("p");
    empty.className = "empty-state small";
    empty.textContent = "No sources yet — add one below, or run Start Research.";
    inner.appendChild(empty);
  }

  inner.appendChild(buildAddSourceForm(topic));

  if (topic.dismissedSources.length > 0) inner.appendChild(buildDismissedSection(topic));

  inner.appendChild(buildAiSections(topic));

  card.appendChild(inner);
  return card;
}

function buildTopicHeader(topic) {
  const header = document.createElement("div");
  header.className = "topic-header";

  const name = document.createElement("h2");
  name.className = "topic-name";
  name.textContent = topic.name;

  const deleteTopicBtn = document.createElement("button");
  deleteTopicBtn.className = "remove-btn";
  deleteTopicBtn.title = "Delete topic";
  deleteTopicBtn.textContent = "🗑";
  deleteTopicBtn.addEventListener("click", () => {
    pendingDelete = { type: "topic", topicId: topic.id };
    const count = topic.sources.length;
    confirmMessage.textContent = `Delete "${topic.name}" and its ${count} source${count === 1 ? "" : "s"}? This can't be undone.`;
    confirmOverlay.classList.add("open");
  });

  header.appendChild(name);
  header.appendChild(deleteTopicBtn);
  return header;
}

function buildTopicMeta(topic) {
  const meta = document.createElement("div");
  meta.className = "topic-meta";

  if (topic.purpose) {
    const purpose = document.createElement("p");
    purpose.className = "topic-purpose";
    purpose.textContent = `Purpose: ${topic.purpose}`;
    meta.appendChild(purpose);
  }

  const row = document.createElement("div");
  row.className = "meta-row";

  const statusSelect = document.createElement("select");
  statusSelect.className = "status-select";
  for (const [value, label] of [["", "No status"], ["unread", "Unread"], ["reviewed", "Reviewed"], ["important", "Important"]]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    statusSelect.appendChild(opt);
  }
  statusSelect.value = topic.status || "";
  statusSelect.addEventListener("change", () => {
    setStatus(topics, topic.id, statusSelect.value || null);
  });
  row.appendChild(statusSelect);

  for (const tag of topic.tags) {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    const label = document.createElement("span");
    label.textContent = tag;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.title = `Remove tag "${tag}"`;
    removeBtn.addEventListener("click", () => {
      removeTag(topics, topic.id, tag);
      renderTopics();
    });
    chip.appendChild(label);
    chip.appendChild(removeBtn);
    row.appendChild(chip);
  }

  const tagInput = document.createElement("input");
  tagInput.type = "text";
  tagInput.className = "tag-add-input";
  tagInput.placeholder = "+ tag";
  tagInput.maxLength = 24;
  tagInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (addTag(topics, topic.id, tagInput.value)) renderTopics();
    else tagInput.value = "";
  });
  row.appendChild(tagInput);

  meta.appendChild(row);
  return meta;
}

function buildResearchRow(topic) {
  const row = document.createElement("div");
  row.className = "research-row";

  const runningJob = activeJobs[topic.id]?.research;

  const btn = document.createElement("button");
  btn.className = "ghost-btn small-btn";
  btn.textContent = runningJob ? "Researching…" : "🔎 Start Research";
  btn.disabled = Boolean(runningJob);
  btn.addEventListener("click", () => startResearch(topic));
  row.appendChild(btn);

  if (runningJob) {
    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill indeterminate";
    fill.dataset.researchProgress = topic.id;
    track.appendChild(fill);
    row.appendChild(track);

    const label = document.createElement("span");
    label.className = "progress-label";
    label.dataset.researchLabel = topic.id;
    label.textContent = "Starting…";
    row.appendChild(label);
  }

  return row;
}

function buildSourceItem(topic, source) {
  const li = document.createElement("li");
  li.className = "source-file";
  li.dataset.sourceId = source.id;

  const link = document.createElement("a");
  link.className = "source-title";
  link.textContent = source.title;
  if (URL_SCHEME_RE.test(source.url)) {
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  } else {
    link.classList.add("plain");
  }
  li.appendChild(link);

  if (source.kind && SOURCE_KIND_ICON[source.kind]) {
    const kindBadge = document.createElement("span");
    kindBadge.className = "source-kind";
    kindBadge.title = source.kind === "paper" ? "Academic paper" : "Web article";
    kindBadge.textContent = SOURCE_KIND_ICON[source.kind];
    li.appendChild(kindBadge);
  }

  const actions = document.createElement("div");
  actions.className = "source-actions";

  if (source.origin === "research") {
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "remove-btn";
    dismissBtn.title = "Dismiss (won't be used in summaries, recoverable below)";
    dismissBtn.textContent = "✕";
    dismissBtn.addEventListener("click", () => {
      dismissSource(topics, topic.id, source.id);
      renderTopics();
    });
    actions.appendChild(dismissBtn);
  } else {
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "remove-btn";
    deleteBtn.title = "Delete source";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", () => {
      pendingDelete = { type: "source", topicId: topic.id, sourceId: source.id };
      confirmMessage.textContent = `Delete "${source.title}"?`;
      confirmOverlay.classList.add("open");
    });
    actions.appendChild(deleteBtn);
  }

  li.appendChild(actions);
  return li;
}

function buildAddSourceForm(topic) {
  const form = document.createElement("form");
  form.className = "add-source-form";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "source-title-input";
  titleInput.placeholder = "Source title";
  titleInput.maxLength = 120;
  titleInput.required = true;
  titleInput.autocomplete = "off";

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.className = "source-url-input";
  urlInput.placeholder = "https://…";
  urlInput.maxLength = 500;
  urlInput.required = true;
  urlInput.autocomplete = "off";

  const addBtn = document.createElement("button");
  addBtn.type = "submit";
  addBtn.className = "ghost-btn small-btn";
  addBtn.textContent = "+ Add Source";

  form.appendChild(titleInput);
  form.appendChild(urlInput);
  form.appendChild(addBtn);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    let url = urlInput.value.trim();
    if (!title || !url) return;
    if (!URL_SCHEME_RE.test(url)) url = `https://${url}`;

    addSource(topics, topic.id, title, url);
    renderTopics();
  });

  return form;
}

function buildDismissedSection(topic) {
  const section = document.createElement("div");
  section.className = "dismissed-section";

  const toggle = document.createElement("button");
  toggle.className = "dismissed-toggle";
  const open = dismissedOpen.has(topic.id);
  toggle.textContent = `${open ? "▾" : "▸"} Dismissed (${topic.dismissedSources.length})`;
  toggle.addEventListener("click", () => {
    if (dismissedOpen.has(topic.id)) dismissedOpen.delete(topic.id);
    else dismissedOpen.add(topic.id);
    renderTopics();
  });
  section.appendChild(toggle);

  if (open) {
    const list = document.createElement("ul");
    list.className = "dismissed-list";
    for (const source of topic.dismissedSources) {
      const li = document.createElement("li");
      li.className = "dismissed-item";

      const span = document.createElement("span");
      span.textContent = source.title;
      li.appendChild(span);

      const restoreBtn = document.createElement("button");
      restoreBtn.className = "restore-btn";
      restoreBtn.textContent = "↩ Restore";
      restoreBtn.addEventListener("click", () => {
        restoreSource(topics, topic.id, source.id);
        renderTopics();
      });
      li.appendChild(restoreBtn);

      list.appendChild(li);
    }
    section.appendChild(list);
  }

  return section;
}

// ---------- AI: summary + quiz ----------

function buildAiSections(topic) {
  const wrap = document.createElement("div");
  wrap.className = "ai-sections";
  wrap.appendChild(buildSummaryBlock(topic));
  wrap.appendChild(buildQuizBlock(topic));
  return wrap;
}

function latestSummary(topic) {
  return topic.aiSummary.length > 0 ? topic.aiSummary[topic.aiSummary.length - 1] : null;
}

function buildSummaryBlock(topic) {
  const block = document.createElement("div");
  block.className = "ai-block";

  const header = document.createElement("div");
  header.className = "ai-block-header";

  const label = document.createElement("span");
  label.className = "ai-label";
  label.textContent = "Summary";
  header.appendChild(label);

  const running = activeJobs[topic.id]?.summary;
  const hasActiveSources = topic.sources.length > 0;

  if (topic.aiSummary.length > 1) {
    const select = document.createElement("select");
    select.className = "version-select";
    topic.aiSummary.forEach((v, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Version ${i + 1} of ${topic.aiSummary.length} — ${new Date(v.generatedAt).toLocaleString()}`;
      select.appendChild(opt);
    });
    select.value = String(topic.aiSummary.length - 1);
    select.addEventListener("change", () => {
      textEl.textContent = topic.aiSummary[Number(select.value)].text;
      metaEl.textContent = `${topic.aiSummary[Number(select.value)].wordCount} words`;
    });
    header.appendChild(select);
  }

  const genBtn = document.createElement("button");
  genBtn.className = "ghost-btn small-btn";
  genBtn.textContent = running ? "Generating…" : topic.aiSummary.length > 0 ? "↻ Regenerate" : "✨ Generate Summary";
  genBtn.disabled = Boolean(running) || !hasActiveSources;
  genBtn.title = hasActiveSources ? "" : "Add or find at least one source first";
  genBtn.addEventListener("click", () => startSummaryGeneration(topic));
  header.appendChild(genBtn);

  block.appendChild(header);

  if (running) {
    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill indeterminate";
    fill.dataset.summaryProgress = topic.id;
    track.appendChild(fill);
    block.appendChild(track);

    const progLabel = document.createElement("span");
    progLabel.className = "progress-label";
    progLabel.dataset.summaryLabel = topic.id;
    progLabel.textContent = "Starting…";
    block.appendChild(progLabel);
  }

  const latest = latestSummary(topic);
  const textEl = document.createElement("p");
  textEl.className = latest ? "summary-text" : "ai-placeholder-text";
  textEl.textContent = latest ? latest.text : "Not generated yet";
  block.appendChild(textEl);

  const metaEl = document.createElement("p");
  metaEl.className = "summary-meta";
  metaEl.textContent = latest ? `${latest.wordCount} words` : "";
  block.appendChild(metaEl);

  return block;
}

function buildQuizBlock(topic) {
  const block = document.createElement("div");
  block.className = "ai-block";

  const header = document.createElement("div");
  header.className = "ai-block-header";

  const label = document.createElement("span");
  label.className = "ai-label";
  label.textContent = "Quiz";
  header.appendChild(label);

  const running = activeJobs[topic.id]?.quiz;
  const hasSummary = latestSummary(topic) !== null;

  const genBtn = document.createElement("button");
  genBtn.className = "ghost-btn small-btn";
  genBtn.textContent = running ? "Generating…" : topic.quiz ? "↻ Regenerate" : "✨ Generate Quiz";
  genBtn.disabled = Boolean(running) || !hasSummary;
  genBtn.title = hasSummary ? "" : "Generate a summary first";
  genBtn.addEventListener("click", () => startQuizGeneration(topic));
  header.appendChild(genBtn);

  block.appendChild(header);

  if (running) {
    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill indeterminate";
    track.appendChild(fill);
    block.appendChild(track);
  }

  if (topic.quiz && topic.quiz.questions.length > 0) {
    const list = document.createElement("ul");
    list.className = "quiz-list";
    topic.quiz.questions.forEach((q, i) => {
      const li = document.createElement("li");

      const question = document.createElement("p");
      question.className = "quiz-question";
      question.textContent = `${i + 1}. ${q.question}`;
      li.appendChild(question);

      if (Array.isArray(q.options) && q.options.length > 0) {
        const optList = document.createElement("ul");
        optList.className = "quiz-options";
        for (const opt of q.options) {
          const optLi = document.createElement("li");
          optLi.textContent = opt;
          optList.appendChild(optLi);
        }
        li.appendChild(optList);
      }

      const reveal = document.createElement("span");
      reveal.className = "quiz-answer";
      reveal.textContent = "Show answer";
      const answerText = document.createElement("p");
      answerText.className = "quiz-answer-text";
      answerText.textContent = q.answer;
      reveal.addEventListener("click", () => {
        answerText.classList.toggle("shown");
        reveal.textContent = answerText.classList.contains("shown") ? "Hide answer" : "Show answer";
      });
      li.appendChild(reveal);
      li.appendChild(answerText);

      list.appendChild(li);
    });
    block.appendChild(list);
  } else if (!running) {
    const placeholder = document.createElement("p");
    placeholder.className = "ai-placeholder-text";
    placeholder.textContent = "Not generated yet";
    block.appendChild(placeholder);
  }

  return block;
}

// ---------- Job orchestration ----------

function startResearch(topic) {
  if (activeJobs[topic.id]?.research) return;
  activeJobs[topic.id] = { ...activeJobs[topic.id], research: "pending" };
  renderTopics();

  apiPost(`/api/topics/${topic.id}/research`, {
    name: topic.name,
    purpose: topic.purpose,
    seedReferences: topic.seedReferences,
    depthTier: topic.depthTier || "short"
  })
    .then(({ jobId }) => {
      activeJobs[topic.id].research = jobId;
      pollJob(jobId, {
        onProgress: (p) => updateInlineProgress("research", topic.id, p),
        onDone: (result) => {
          delete activeJobs[topic.id].research;
          addSourcesBulk(topics, topic.id, result.sources || []);
          renderTopics();
        },
        onError: (message) => {
          delete activeJobs[topic.id].research;
          alert(`Research failed: ${message}`);
          renderTopics();
        }
      });
    })
    .catch((err) => {
      delete activeJobs[topic.id].research;
      alert(`Could not start research: ${err.message}`);
      renderTopics();
    });
}

function startSummaryGeneration(topic) {
  if (activeJobs[topic.id]?.summary) return;
  activeJobs[topic.id] = { ...activeJobs[topic.id], summary: "pending" };
  renderTopics();

  const sources = topic.sources.map((s) => ({ title: s.title, url: s.url, kind: s.kind, abstract: s.abstract }));

  apiPost(`/api/topics/${topic.id}/generate-summary`, { name: topic.name, purpose: topic.purpose, sources })
    .then(({ jobId }) => {
      activeJobs[topic.id].summary = jobId;
      pollJob(jobId, {
        onProgress: (p) => updateInlineProgress("summary", topic.id, p),
        onDone: (result) => {
          delete activeJobs[topic.id].summary;
          addSummaryVersion(topics, topic.id, result.text || "");
          renderTopics();
        },
        onError: (message) => {
          delete activeJobs[topic.id].summary;
          alert(`Summary generation failed: ${message}`);
          renderTopics();
        }
      });
    })
    .catch((err) => {
      delete activeJobs[topic.id].summary;
      alert(`Could not start summary generation: ${err.message}`);
      renderTopics();
    });
}

function startQuizGeneration(topic) {
  if (activeJobs[topic.id]?.quiz) return;
  const summary = latestSummary(topic);
  if (!summary) return;

  activeJobs[topic.id] = { ...activeJobs[topic.id], quiz: "pending" };
  renderTopics();

  apiPost(`/api/topics/${topic.id}/generate-quiz`, { name: topic.name, purpose: topic.purpose, summaryText: summary.text })
    .then(({ jobId }) => {
      activeJobs[topic.id].quiz = jobId;
      pollJob(jobId, {
        onProgress: () => {},
        onDone: (result) => {
          delete activeJobs[topic.id].quiz;
          setQuiz(topics, topic.id, result.questions || []);
          renderTopics();
        },
        onError: (message) => {
          delete activeJobs[topic.id].quiz;
          alert(`Quiz generation failed: ${message}`);
          renderTopics();
        }
      });
    })
    .catch((err) => {
      delete activeJobs[topic.id].quiz;
      alert(`Could not start quiz generation: ${err.message}`);
      renderTopics();
    });
}

function updateInlineProgress(kind, topicId, progress) {
  const label = document.querySelector(`[data-${kind}-label="${topicId}"]`);
  if (label && progress?.stage) label.textContent = progress.stage;
  const fill = document.querySelector(`[data-${kind}-progress="${topicId}"]`);
  if (fill && progress?.total > 0) {
    fill.classList.remove("indeterminate");
    fill.style.width = `${Math.min(100, Math.round((progress.found / progress.total) * 100))}%`;
  }
}

// ---------- Add topic ----------

addTopicForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = topicNameInput.value.trim();
  if (!name) return;

  const purpose = topicPurposeInput.value.trim();
  const seedReferences = topicSeedsInput.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const depthTier = topicDepthInput.value;

  addTopic(topics, name, { purpose, seedReferences, depthTier });
  renderTopics();
  addTopicForm.reset();
  topicDepthInput.value = "short";
  topicNameInput.focus();
});

// ---------- Search / filters ----------

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  renderTopics();
});

statusFilter.addEventListener("change", () => {
  statusFilterValue = statusFilter.value;
  renderTopics();
});

tagFilter.addEventListener("change", () => {
  tagFilterValue = tagFilter.value;
  renderTopics();
});

// ---------- Confirm overlay ----------

confirmCancel.addEventListener("click", () => {
  pendingDelete = null;
  confirmOverlay.classList.remove("open");
});

confirmOk.addEventListener("click", () => {
  if (pendingDelete?.type === "topic") {
    deleteTopic(topics, pendingDelete.topicId);
  } else if (pendingDelete?.type === "source") {
    deleteSource(topics, pendingDelete.topicId, pendingDelete.sourceId);
  }
  pendingDelete = null;
  confirmOverlay.classList.remove("open");
  renderTopics();
});

confirmOverlay.addEventListener("click", (e) => {
  if (e.target === confirmOverlay) {
    pendingDelete = null;
    confirmOverlay.classList.remove("open");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (confirmOverlay.classList.contains("open")) {
    pendingDelete = null;
    confirmOverlay.classList.remove("open");
  }
  if (settingsOverlay.classList.contains("open")) settingsOverlay.classList.remove("open");
});

// ---------- Settings (API key) ----------

async function openSettings() {
  settingsOverlay.classList.add("open");
  try {
    const settings = await apiGet("/api/settings");
    settingsStatus.textContent = settings.hasKey
      ? `A key is already configured (${settings.tier === "paid" ? "Paid / Pro" : "Free / Flash"} tier). Save a new key below to replace it.`
      : "No key configured yet — generations will fail until one is set.";
    document.querySelector(`input[name="tier"][value="${settings.tier}"]`).checked = true;
  } catch {
    settingsStatus.textContent = "Could not reach the server to check settings.";
  }
}

settingsToggle.addEventListener("click", openSettings);
settingsCancel.addEventListener("click", () => settingsOverlay.classList.remove("open"));
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.remove("open");
});

settingsSave.addEventListener("click", async () => {
  const apiKey = settingsKeyInput.value.trim();
  const tier = document.querySelector('input[name="tier"]:checked').value;
  if (!apiKey) {
    settingsStatus.textContent = "Enter a key before saving.";
    return;
  }
  try {
    await apiPost("/api/settings/key", { apiKey, tier });
    settingsKeyInput.value = "";
    settingsStatus.textContent = "Saved.";
    refreshUsage();
    setTimeout(() => settingsOverlay.classList.remove("open"), 700);
  } catch (err) {
    settingsStatus.textContent = `Could not save: ${err.message}`;
  }
});

// ---------- Voice-to-text ----------

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

function attachMicButtons() {
  document.querySelectorAll(".mic-btn[data-mic-target]").forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => handleMicClick(btn));
  });
}

let activeRecognition = null;

function handleMicClick(button) {
  if (!SpeechRecognitionCtor) {
    alert("Voice input isn't supported in this browser. Try Chrome.");
    return;
  }
  const targetId = button.dataset.micTarget;
  const target = document.getElementById(targetId);
  if (!target) return;

  if (activeRecognition) {
    activeRecognition.stop();
    return;
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => button.classList.add("listening");
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    target.value = target.value ? `${target.value} ${transcript}` : transcript;
  };
  recognition.onerror = () => button.classList.remove("listening");
  recognition.onend = () => {
    button.classList.remove("listening");
    activeRecognition = null;
  };

  activeRecognition = recognition;
  recognition.start();
}

// ---------- Theme ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) {
    applyTheme(saved);
  } else {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }
}

themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});

// ---------- Server lifecycle ----------
//
// The server shuts itself down once it stops hearing from any tab (see server.js) —
// this keeps it heartbeating while the app is open, and gives it an explicit nudge
// the instant the tab actually closes, so shutdown is near-immediate in the normal
// case rather than waiting out the timeout.

const HEARTBEAT_INTERVAL_MS = 8000;

function sendHeartbeat() {
  fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
}

setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
sendHeartbeat();

window.addEventListener("pagehide", () => {
  navigator.sendBeacon("/api/shutdown");
});

// ---------- Init ----------

initTheme();
populateDepthSelect();
renderTopics();
refreshUsage();
