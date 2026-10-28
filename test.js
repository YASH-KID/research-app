// Runnable assertion tests for storage.js — open test.html in a browser to run them.
// Snapshot the real data first so running tests never destroys anything the user saved.

const BACKUP_TOPICS = localStorage.getItem(TOPICS_KEY);

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (err) {
    results.push({ name, pass: false, error: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message || "Not equal"} — expected ${e}, got ${a}`);
}

test("generateId returns non-empty, unique strings", () => {
  const ids = new Set();
  for (let i = 0; i < 20; i++) {
    const id = generateId();
    assert(typeof id === "string" && id.length > 0, "id should be a non-empty string");
    ids.add(id);
  }
  assertEqual(ids.size, 20, "all generated ids should be unique");
});

test("loadTopics returns [] when the localStorage key is missing", () => {
  localStorage.removeItem(TOPICS_KEY);
  assertEqual(loadTopics(), [], "expected an empty array");
});

test("loadTopics returns [] (does not throw) on invalid JSON", () => {
  localStorage.setItem(TOPICS_KEY, "{not valid json");
  assertEqual(loadTopics(), [], "expected an empty array on parse failure");
});

test("saveTopics + loadTopics round-trips a fully-shaped topic unchanged", () => {
  const sample = [
    {
      id: "a1",
      name: "Sample",
      createdAt: 1,
      purpose: "",
      seedReferences: [],
      depthTier: null,
      tags: [],
      status: null,
      sources: [],
      dismissedSources: [],
      aiSummary: [],
      quiz: null
    }
  ];
  saveTopics(sample);
  assertEqual(loadTopics(), sample, "round-tripped data should match what was saved");
});

test("loadTopics backfills defaults for old-format (Session 1) topics", () => {
  const oldFormat = [{ id: "old1", name: "Legacy Topic", createdAt: 5, sources: [], aiSummary: null, quiz: null }];
  localStorage.setItem(TOPICS_KEY, JSON.stringify(oldFormat));
  const loaded = loadTopics();
  assertEqual(loaded.length, 1, "the legacy topic should still load");
  const t = loaded[0];
  assertEqual(t.purpose, "", "purpose should default to an empty string");
  assertEqual(t.seedReferences, [], "seedReferences should default to []");
  assertEqual(t.depthTier, null, "depthTier should default to null");
  assertEqual(t.tags, [], "tags should default to []");
  assertEqual(t.status, null, "status should default to null");
  assertEqual(t.dismissedSources, [], "dismissedSources should default to []");
  assertEqual(t.aiSummary, [], "a null legacy aiSummary should become []");
});

test("loadTopics wraps a legacy string aiSummary into a single version", () => {
  const oldFormat = [{ id: "old2", name: "Legacy Summary", createdAt: 5, sources: [], aiSummary: "Old summary text", quiz: null }];
  localStorage.setItem(TOPICS_KEY, JSON.stringify(oldFormat));
  const loaded = loadTopics();
  assertEqual(loaded[0].aiSummary.length, 1, "the legacy string summary should become one version");
  assertEqual(loaded[0].aiSummary[0].text, "Old summary text");
});

test("addTopic creates a topic with the correct shape and persists it", () => {
  localStorage.removeItem(TOPICS_KEY);
  const topics = [];
  const topic = addTopic(topics, "Quantum Computing");
  assert(topic !== null, "addTopic should return the created topic");
  assert(typeof topic.id === "string" && topic.id.length > 0, "topic needs a non-empty id");
  assertEqual(topic.name, "Quantum Computing", "topic name should be stored trimmed");
  assertEqual(topic.sources, [], "a new topic should start with no sources");
  assertEqual(topic.aiSummary, [], "aiSummary should default to []");
  assertEqual(topic.quiz, null, "quiz should default to null");
  assertEqual(topic.tags, [], "tags should default to []");
  assertEqual(topic.status, null, "status should default to null");
  assertEqual(topics.length, 1, "topics array should contain the new topic");
  assertEqual(loadTopics().length, 1, "the topic should be persisted to localStorage");
});

test("addTopic accepts purpose, seedReferences, and depthTier", () => {
  const topics = [];
  const topic = addTopic(topics, "Fusion Energy", {
    purpose: "background for an article",
    seedReferences: ["https://arxiv.org/abs/1234.5678"],
    depthTier: "medium"
  });
  assertEqual(topic.purpose, "background for an article");
  assertEqual(topic.seedReferences, ["https://arxiv.org/abs/1234.5678"]);
  assertEqual(topic.depthTier, "medium");
});

test("addTopic rejects an unknown depthTier", () => {
  const topics = [];
  const topic = addTopic(topics, "Topic", { depthTier: "not-a-real-tier" });
  assertEqual(topic.depthTier, null, "an invalid depthTier should be dropped, not stored");
});

test("addTopic rejects an empty/whitespace-only name", () => {
  const topics = [];
  const topic = addTopic(topics, "   ");
  assertEqual(topic, null, "addTopic should return null for a blank name");
  assertEqual(topics.length, 0, "no topic should have been added");
});

test("addSource appends a source to the correct topic only", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  const t2 = addTopic(topics, "Topic B");
  const source = addSource(topics, t1.id, "Article One", "https://example.com/one");
  assert(source !== null, "addSource should return the created source");
  assertEqual(t1.sources.length, 1, "Topic A should have exactly one source");
  assertEqual(t2.sources.length, 0, "Topic B should be untouched");
  assertEqual(t1.sources[0].title, "Article One");
  assertEqual(t1.sources[0].url, "https://example.com/one");
  assertEqual(t1.sources[0].origin, "manual", "sources added directly should default to manual origin");
});

test("addSource with an unknown topicId does not throw or mutate any topic", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  let result;
  let threw = false;
  try {
    result = addSource(topics, "nonexistent-id", "Title", "https://example.com");
  } catch {
    threw = true;
  }
  assert(!threw, "addSource should not throw for an unknown topicId");
  assertEqual(result, null, "addSource should return null for an unknown topicId");
  assertEqual(t1.sources.length, 0, "the existing topic should be untouched");
});

test("addSource rejects an empty title or empty url", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  assertEqual(addSource(topics, t1.id, "", "https://example.com"), null, "empty title should be rejected");
  assertEqual(addSource(topics, t1.id, "Title", ""), null, "empty url should be rejected");
  assertEqual(t1.sources.length, 0, "no sources should have been added");
});

test("addSourcesBulk adds every valid source and skips invalid ones in one save", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  const added = addSourcesBulk(topics, t1.id, [
    { title: "Paper One", url: "https://example.com/1", kind: "paper", abstract: "abstract text" },
    { title: "", url: "https://example.com/skip" },
    { title: "Article One", url: "https://example.com/2", kind: "article" }
  ]);
  assertEqual(added.length, 2, "only the two valid sources should be added");
  assertEqual(t1.sources.length, 2, "the topic should have exactly two sources");
  assertEqual(t1.sources[0].origin, "research", "bulk-added sources should be marked as research origin");
  assertEqual(t1.sources[0].kind, "paper");
  assertEqual(t1.sources[1].kind, "article");
});

test("deleteSource removes only the targeted source", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  const s1 = addSource(topics, t1.id, "One", "https://example.com/1");
  const s2 = addSource(topics, t1.id, "Two", "https://example.com/2");
  const removed = deleteSource(topics, t1.id, s1.id);
  assert(removed === true, "deleteSource should report success");
  assertEqual(t1.sources.length, 1, "exactly one source should remain");
  assertEqual(t1.sources[0].id, s2.id, "the remaining source should be the untouched one");
});

test("dismissSource moves a source to dismissedSources, restoreSource moves it back", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  const s1 = addSource(topics, t1.id, "One", "https://example.com/1");

  assert(dismissSource(topics, t1.id, s1.id) === true, "dismissSource should report success");
  assertEqual(t1.sources.length, 0, "the source should be removed from the active list");
  assertEqual(t1.dismissedSources.length, 1, "the source should be moved to dismissedSources");
  assertEqual(t1.dismissedSources[0].id, s1.id);

  assert(restoreSource(topics, t1.id, s1.id) === true, "restoreSource should report success");
  assertEqual(t1.sources.length, 1, "the source should be back in the active list");
  assertEqual(t1.dismissedSources.length, 0, "dismissedSources should be empty again");
});

test("dismissSource returns false for an unknown sourceId", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  assertEqual(dismissSource(topics, t1.id, "nonexistent"), false);
});

test("deleteTopic removes the topic and all its sources", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  addSource(topics, t1.id, "One", "https://example.com/1");
  const t2 = addTopic(topics, "Topic B");
  const removed = deleteTopic(topics, t1.id);
  assert(removed === true, "deleteTopic should report success");
  assertEqual(topics.length, 1, "only Topic B should remain");
  assertEqual(topics[0].id, t2.id, "the remaining topic should be Topic B");
  assertEqual(loadTopics().length, 1, "the deletion should be persisted");
});

test("setPurpose trims and stores the purpose", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  assert(setPurpose(topics, t1.id, "  learn the basics  ") === true);
  assertEqual(t1.purpose, "learn the basics");
});

test("setDepthTier accepts a valid tier and rejects an invalid one", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  assert(setDepthTier(topics, t1.id, "very_indepth") === true);
  assertEqual(t1.depthTier, "very_indepth");
  assert(setDepthTier(topics, t1.id, "not-a-tier") === false);
  assertEqual(t1.depthTier, "very_indepth", "an invalid tier should not overwrite the existing one");
});

test("setSeedReferences trims entries and drops blanks", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  setSeedReferences(topics, t1.id, ["  https://a.com  ", "", "  ", "https://b.com"]);
  assertEqual(t1.seedReferences, ["https://a.com", "https://b.com"]);
});

test("addTag lowercases and de-duplicates, removeTag removes", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  assert(addTag(topics, t1.id, "Health") === true);
  assertEqual(t1.tags, ["health"]);
  assert(addTag(topics, t1.id, "health") === false, "duplicate tag should be rejected");
  assertEqual(t1.tags.length, 1);
  assert(removeTag(topics, t1.id, "health") === true);
  assertEqual(t1.tags, []);
});

test("setStatus accepts valid statuses, null, and rejects invalid ones", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  assert(setStatus(topics, t1.id, "important") === true);
  assertEqual(t1.status, "important");
  assert(setStatus(topics, t1.id, null) === true);
  assertEqual(t1.status, null);
  assert(setStatus(topics, t1.id, "not-a-status") === false);
});

test("addSummaryVersion appends versions with word counts, keeping history", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  const v1 = addSummaryVersion(topics, t1.id, "one two three four five");
  assertEqual(v1.wordCount, 5);
  assertEqual(t1.aiSummary.length, 1);

  const v2 = addSummaryVersion(topics, t1.id, "a different second summary here");
  assertEqual(t1.aiSummary.length, 2, "regenerating should append, not overwrite");
  assertEqual(t1.aiSummary[0].text, v1.text, "the first version should still be there");
  assertEqual(t1.aiSummary[1].text, v2.text);
});

test("addSummaryVersion rejects empty text", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  assertEqual(addSummaryVersion(topics, t1.id, "   "), null);
  assertEqual(t1.aiSummary.length, 0);
});

test("setQuiz stores questions with a timestamp, rejects an empty list", () => {
  const topics = [];
  const t1 = addTopic(topics, "Topic A");
  assertEqual(setQuiz(topics, t1.id, []), null, "an empty question list should be rejected");
  const quiz = setQuiz(topics, t1.id, [{ question: "Q1?", answer: "A1" }]);
  assert(quiz !== null);
  assertEqual(t1.quiz.questions.length, 1);
  assert(typeof t1.quiz.generatedAt === "number");
});

// Restore whatever was really saved before the tests ran.
if (BACKUP_TOPICS === null) {
  localStorage.removeItem(TOPICS_KEY);
} else {
  localStorage.setItem(TOPICS_KEY, BACKUP_TOPICS);
}

function render() {
  const container = document.getElementById("results");
  const passCount = results.filter((r) => r.pass).length;

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = `${passCount} / ${results.length} tests passed`;
  summary.classList.add(passCount === results.length ? "all-pass" : "some-fail");
  container.appendChild(summary);

  const list = document.createElement("ul");
  for (const r of results) {
    const li = document.createElement("li");
    li.className = r.pass ? "pass" : "fail";
    li.textContent = (r.pass ? "PASS — " : "FAIL — ") + r.name + (r.error ? ` (${r.error})` : "");
    list.appendChild(li);
  }
  container.appendChild(list);
}

render();
