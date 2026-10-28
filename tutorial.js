// Self-contained onboarding tour. Runs after script.js has defined the app's real
// functions/state (topics, renderTopics, startResearch, activeJobs, etc.) and reuses
// them directly rather than re-implementing anything — the live demo step is a real
// research run through the real code path, not a simulation.

(function () {
  const TUTORIAL_SEEN_KEY = "research-app-tutorial-seen";
  const DEMO_TOPIC_NAME = "Benefits of walking 10,000 steps a day";
  const DEMO_PURPOSE = "Tutorial demo — seeing how research and summaries work";

  const overlay = document.getElementById("tutorialOverlay");
  const spotlight = document.getElementById("tutorialSpotlight");
  const tooltip = document.getElementById("tutorialTooltip");
  const titleEl = document.getElementById("tutorialTitle");
  const textEl = document.getElementById("tutorialText");
  const progressEl = document.getElementById("tutorialProgress");
  const skipBtn = document.getElementById("tutorialSkip");
  const backBtn = document.getElementById("tutorialBack");
  const nextBtn = document.getElementById("tutorialNext");
  const replayBtn = document.getElementById("tutorialReplayBtn");

  let steps = [];
  let stepIndex = 0;
  let demoTopicId = null;
  let busy = false;

  function demoCard() {
    return demoTopicId ? document.querySelector(`.topic-card[data-topic-id="${demoTopicId}"]`) : null;
  }

  function resetFilters() {
    searchQuery = "";
    statusFilterValue = "";
    tagFilterValue = "";
    searchInput.value = "";
    statusFilter.value = "";
    tagFilter.value = "";
  }

  async function ensureDemoTopic() {
    if (demoTopicId) return;
    resetFilters();
    topicNameInput.value = DEMO_TOPIC_NAME;
    topicPurposeInput.value = DEMO_PURPOSE;
    topicSeedsInput.value = "";
    topicDepthInput.value = "very_short";
    addTopicForm.requestSubmit();
    demoTopicId = topics[topics.length - 1].id;
  }

  function removeDemoTopic() {
    if (!demoTopicId) return;
    deleteTopic(topics, demoTopicId);
    demoTopicId = null;
    renderTopics();
  }

  async function runLiveResearchDemo() {
    const topic = topics.find((t) => t.id === demoTopicId);
    if (!topic) return;
    startResearch(topic);
    // startResearch is async/polling internally; wait for it to settle (success or
    // error) by watching the same activeJobs flag it manages.
    while (activeJobs[demoTopicId]?.research) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  function buildSteps(hasKey) {
    const list = [
      {
        target: () => null,
        title: "Welcome to Research App",
        text: () =>
          "This app finds papers and articles for a topic, writes a purpose-driven AI summary, and quizzes you on it.\n\n" +
          "It runs a small local server automatically — opening it via the Desktop shortcut starts the server for you, and it shuts down on its own when you close the app. If you ever need to start it by hand, run \"node server.js\" from the server folder.\n\n" +
          "This quick tour shows how it fits together — skip anytime, and replay it later from the 🎓 button in the corner."
      },
      {
        target: () => document.getElementById("settingsToggle"),
        title: "Your API key",
        text: () =>
          hasKey
            ? "This is where your Gemini API key lives — yours is already configured. Click here anytime to change it or switch between Free and Paid tiers."
            : "Click here to add a free Gemini API key from Google AI Studio — you'll need one before research, summaries, or quizzes will work."
      },
      {
        target: () => document.getElementById("addTopicForm"),
        title: "Creating a topic",
        text: () =>
          "Every topic starts here: a name, a purpose (this shapes what gets found and how the summary reads), optional sources you already have, and how deep the research should go.\n\nLet's create a demo one.",
        onNext: async () => {
          await ensureDemoTopic();
        }
      }
    ];

    if (hasKey) {
      list.push({
        target: () => {
          const card = demoCard();
          return card ? card.querySelector(".research-row button") : null;
        },
        title: "Finding real sources",
        text: () => "Watch — this runs a real search for academic papers and web articles right now.",
        onEnter: async () => {
          await runLiveResearchDemo();
        }
      });
      list.push({
        target: () => {
          const card = demoCard();
          return card ? card.querySelector(".source-list") : null;
        },
        title: "What it found",
        text: () =>
          "These are real sources it just found — 📄 for academic papers, 🌐 for web articles. Not interested in one? Click ✕ to dismiss it — recoverable, not deleted, and it just won't be used in the summary."
      });
    } else {
      list.push({
        target: () => {
          const card = demoCard();
          return card ? card.querySelector(".research-row button") : null;
        },
        title: "Finding sources",
        text: () =>
          "Click here and it automatically finds a mix of real academic papers and web articles, weighted toward whichever fits your topic. It needs an API key first (previous step), so we won't run it for real just yet."
      });
    }

    list.push(
      {
        target: () => {
          const card = demoCard();
          return card ? card.querySelectorAll(".ai-block")[0] : null;
        },
        title: "Generating a summary",
        text: () =>
          "This reads every source's actual page content and writes a 2000+ word summary tailored to your purpose. Every regeneration is kept as a version, never overwritten — we won't run a real one now, it takes a couple minutes, but that's the button."
      },
      {
        target: () => {
          const card = demoCard();
          return card ? card.querySelectorAll(".ai-block")[1] : null;
        },
        title: "Generating a quiz",
        text: () => "Once you have a summary, this builds a quiz from it, with click-to-reveal answers."
      },
      {
        target: () => document.querySelector(".toolbar"),
        title: "Search & filter",
        text: () => "As your topic list grows, search and filter by tag or status from here."
      },
      {
        target: () => document.querySelector(".corner-cluster"),
        title: "Usage estimate",
        text: () =>
          "This shows roughly how many Gemini calls you've used today against Google's published free-tier limit — this app's own estimate, not an official number from Google."
      },
      {
        target: () => null,
        title: "That's the tour",
        text: () => "You can replay it anytime from the 🎓 button right here in the corner.",
        onNext: async () => {
          removeDemoTopic();
        }
      }
    );

    return list;
  }

  function setBusyUi(isBusy) {
    busy = isBusy;
    nextBtn.disabled = isBusy;
    backBtn.disabled = isBusy;
    // Skip stays clickable even mid-action (e.g. while the live research demo is
    // running) — a user shouldn't be trapped waiting out a ~30-70s API call with no
    // way to back out. Any in-flight job just gets its result silently discarded
    // (storage.js's findTopic no-ops gracefully once the demo topic is gone).
    nextBtn.textContent = isBusy ? "Working…" : stepIndex === steps.length - 1 ? "Finish" : "Next";
  }

  function positionSpotlight(target) {
    if (!target) {
      spotlight.style.top = `${window.innerHeight / 2}px`;
      spotlight.style.left = `${window.innerWidth / 2}px`;
      spotlight.style.width = "0px";
      spotlight.style.height = "0px";
      return;
    }
    const rect = target.getBoundingClientRect();
    const pad = 8;
    spotlight.style.top = `${rect.top - pad}px`;
    spotlight.style.left = `${rect.left - pad}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;
  }

  function positionTooltip(target) {
    const margin = 16;
    const ttRect = tooltip.getBoundingClientRect();
    if (!target) {
      tooltip.style.top = `${Math.max(margin, (window.innerHeight - ttRect.height) / 2)}px`;
      tooltip.style.left = `${Math.max(margin, (window.innerWidth - ttRect.width) / 2)}px`;
      return;
    }
    const rect = target.getBoundingClientRect();
    let top = rect.bottom + margin;
    if (top + ttRect.height > window.innerHeight - margin) {
      top = rect.top - ttRect.height - margin;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - ttRect.height - margin));
    let left = rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - ttRect.width - margin));
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  let trackerHandle = null;

  // Re-queries the current step's target on every tick rather than closing over one
  // element reference — the live-research step causes real renderTopics() rebuilds
  // mid-step (a fresh "Researching…" state, then again on completion), which detach
  // whatever element was captured earlier. A detached element's getBoundingClientRect
  // is all zeros, which collapsed the spotlight to a point in the corner until this
  // was tracked continuously instead of positioned once.
  function startTracking() {
    stopTracking();
    trackerHandle = setInterval(() => {
      const target = steps[stepIndex]?.target();
      positionSpotlight(target);
      positionTooltip(target);
    }, 250);
  }

  function stopTracking() {
    if (trackerHandle) clearInterval(trackerHandle);
    trackerHandle = null;
  }

  async function renderStep() {
    const step = steps[stepIndex];
    const target = step.target();
    if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });

    titleEl.textContent = step.title;
    textEl.textContent = typeof step.text === "function" ? step.text() : step.text;
    progressEl.textContent = `Step ${stepIndex + 1} of ${steps.length}`;
    backBtn.style.visibility = stepIndex === 0 ? "hidden" : "visible";
    nextBtn.textContent = stepIndex === steps.length - 1 ? "Finish" : "Next";

    positionSpotlight(target);
    positionTooltip(target);
    startTracking();

    if (step.onEnter) {
      setBusyUi(true);
      await step.onEnter();
      setBusyUi(false);
    }
  }

  async function goNext() {
    if (busy) return;
    const step = steps[stepIndex];
    if (step.onNext) {
      setBusyUi(true);
      await step.onNext();
      setBusyUi(false);
    }
    if (stepIndex === steps.length - 1) {
      finishTutorial();
      return;
    }
    stepIndex++;
    renderStep();
  }

  function goBack() {
    if (busy || stepIndex === 0) return;
    stepIndex--;
    renderStep();
  }

  function finishTutorial() {
    stopTracking();
    localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
    overlay.classList.remove("open");
    renderTopics();
  }

  function skipTutorial() {
    removeDemoTopic();
    finishTutorial();
  }

  async function startTutorial() {
    let hasKey = false;
    try {
      const settings = await apiGet("/api/settings");
      hasKey = settings.hasKey;
    } catch {
      hasKey = false;
    }
    steps = buildSteps(hasKey);
    stepIndex = 0;
    demoTopicId = null;
    overlay.classList.add("open");
    renderStep();
  }

  nextBtn.addEventListener("click", goNext);
  backBtn.addEventListener("click", goBack);
  skipBtn.addEventListener("click", skipTutorial);
  replayBtn.addEventListener("click", startTutorial);
  function repositionNow() {
    if (!overlay.classList.contains("open")) return;
    const target = steps[stepIndex]?.target();
    positionSpotlight(target);
    positionTooltip(target);
  }

  window.addEventListener("resize", repositionNow);
  // Chrome throttles background-tab timers, including the tracking interval — if a
  // long-running step (the live research demo) finishes while the user is on another
  // tab/window, force an immediate correct position the moment they come back rather
  // than waiting for a throttled tick to eventually catch up.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) repositionNow();
  });

  // Safety net: if a previous tutorial run never reached Finish/Skip (tab force-closed,
  // browser crash, etc.), its demo topic would otherwise sit in real data forever —
  // this catches it on every load, independent of whether the tour runs again.
  (function cleanupOrphanedDemoTopic() {
    const stray = topics.find((t) => t.name === DEMO_TOPIC_NAME);
    if (stray) {
      deleteTopic(topics, stray.id);
      renderTopics();
    }
  })();

  if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) {
    setTimeout(startTutorial, 400);
  }
})();
