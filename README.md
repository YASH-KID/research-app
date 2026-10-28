# Research App

Create Research Topics, tell it *why* you're researching each one, and let it find
papers and articles, write a real AI summary, and quiz you on it. Session 1 was a
static, no-server notebook; Session 2 turned it into a real research assistant, which
means it now needs a small local server running in the background to talk to Gemini.

## First-time setup

On a machine that already has Node.js (like this dev machine):

1. Install dependencies once: open a terminal in `research-app/server` and run
   `npm install`.
2. Run `Create Desktop Shortcut.bat` once. This creates a **Research App** icon on
   your Desktop that starts the server automatically and opens the app — you don't
   need to keep a terminal window open day-to-day.

On a completely fresh machine with nothing installed, run **`Setup Research App.bat`**
instead — it shows a checklist, installs Node.js automatically if it's missing (no
manual download needed), then does the same npm install + shortcut creation above.
This also works on someone else's PC.

A Gemini API key is required for research/summary/quiz generation to work — see
"API key" below.

## How to open it

Double-click the **Research App** icon on your Desktop. The first launch installs
server dependencies if needed (a minute or so); after that it starts instantly. It
opens as its own app window (no browser tabs/address bar), same as every other app in
this workspace — the difference here is a background server process starts alongside it.

Every open starts a genuinely fresh server (anything already running on the port is
replaced), and it shuts itself down on its own shortly after you close the app —
nothing to remember to stop by hand. Refreshing the page is safe and doesn't restart
it.

You can also start it manually: `node research-app/server/server.js`, then open
`http://localhost:8794` in any browser.

## First-run tour

The first time you open the app, a short guided tour walks through the API key
settings, creating a topic, and — for real — running research on a demo topic so you
can see actual sources come in. That demo topic is deleted automatically once the
tour ends, whether you finish it or skip partway through. Replay it anytime from the
🎓 button in the bottom-left corner, next to the usage counter.

## How it works

- **Create a topic**: give it a name, a **purpose** (why you're researching this —
  it shapes both what gets found and how the summary is written), optionally paste in
  a few papers/articles you already have, and pick a **research depth**:
  - Very Short (~5 sources) · Short (~10) · Medium (~20) · Very In-Depth (30–40,
    genuinely takes real time — expect a few minutes)
- **Start Research**: automatically finds a mix of academic papers (via Semantic
  Scholar) and general web articles (via Google Search), weighted toward whichever
  fits your topic — a physics topic skews toward papers, a "grow my YouTube channel"
  topic skews toward articles. A progress bar shows what it's doing.
- **Dismiss a source** you don't want (✕ on an AI-found source) — it's excluded from
  summaries but not gone forever; expand "Dismissed" below the source list to restore
  it. Manually added sources delete permanently instead (with a confirmation).
- **Generate Summary**: reads every active source's actual page content and writes a
  2000+ word summary tailored to your stated purpose. Every regeneration is kept —
  browse past versions from the dropdown instead of losing them.
- **Generate Quiz**: 8 questions built from the current summary, with a click-to-reveal
  answer.
- **Search, tags, status**: the search bar filters topics and sources by text; add
  tags with the "+ tag" box and filter by them; set a status (Unread/Reviewed/
  Important) per topic and filter by it.
- **Voice input**: click the 🎤 next to the topic name or purpose fields and speak —
  works in Chrome via its built-in speech recognition, no setup needed.
- **Light/dark mode**: the sun/moon button (top-right) switches themes, remembered
  across sessions.

## API key

Click the ⚙️ (gear) icon top-right to open Settings. Paste a Gemini API key (get one
free at [Google AI Studio](https://aistudio.google.com/apikey)) and mark whether it's
a **Free** tier key (uses Gemini Flash) or has **billing enabled** (uses Gemini Pro,
better quality). The key is saved on your own machine's server process — it's never
sent to or stored in the browser page itself.

The circle in the bottom-left corner shows roughly how many Gemini calls you've used
today against Google's published free-tier limit. It's this app's own estimate, not a
number Google reports back — it'll be off if the same key is also used elsewhere.

## Where your data lives

Your topics, sources, summaries, and quizzes are saved in your browser's
`localStorage`, tied to this app's page. That means:

- No account needed. Research/summary/quiz generation needs internet + a valid Gemini
  key; everything else (browsing your saved topics, search, tags) works offline.
- If you clear Chrome's browsing data for this app, or move/rename this folder
  (breaking the shortcut), your saved data could be lost — there's no backup file.
- Your API key lives separately, in `server/data/config.json` on this machine — not
  in the browser, and not affected by clearing browser data.

## Running the tests

Open `test.html` directly in a browser (it only needs `storage.js`, not the backend).
It exercises the data layer — adding/deleting/dismissing/restoring sources, tags,
status, summary versioning, and the migration that upgrades data saved before this
session — and shows a pass/fail count on the page. It temporarily borrows your
`research-app-topics` localStorage key while running and restores your real data
afterward, so it's safe to run any time.

## Moving this app to another computer

Copy the whole folder (without `server/node_modules`) to the other machine and run `Setup Research App.bat` (Windows). It installs Node.js if needed, installs the dependencies and creates the Desktop shortcut. Each person enters their own Gemini API key in Settings; keys are never part of this repository.

## Files in this folder

```
research-app/
├── index.html    <- page structure
├── style.css     <- all visual design (light/dark theme, sketched containers)
├── storage.js    <- data layer only (localStorage, validation, migration)
├── script.js     <- UI logic — rendering, forms, job polling, voice input
├── tutorial.js   <- first-run guided tour, replayable via the 🎓 button
├── test.html / test.js  <- storage.js tests, run in a browser
├── server/
│   ├── server.js       <- Express app: serves the frontend + the API below
│   ├── launch.ps1        <- what the Windows Desktop shortcut runs: starts the
│   │                         server, then opens the browser
│   ├── launch.sh          <- macOS equivalent of launch.ps1
│   ├── lib/                <- Gemini calls, Semantic Scholar, page extraction,
│   │                          job tracking, settings/usage storage
│   └── data/                 <- created on first run: your API key + usage count (git-ignored)
├── icon.ico / icon.icns
├── Create Desktop Shortcut.bat
└── README.md           <- this file
```
