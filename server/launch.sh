#!/bin/bash
# Launcher for the Research App Desktop icon on macOS. Mirrors server/launch.ps1
# (the Windows equivalent): start the backend if it isn't already running, wait for
# it to come up, then open the browser pointed at it.
set -e

SERVER_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8794
NODE_VERSION="22.14.0"
RUNTIME_DIR="$SERVER_DIR/node-runtime"

# GUI apps launched from Finder/Dock don't inherit the PATH set in your shell profile,
# so Node installed via Homebrew or nvm is often invisible here unless added explicitly.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/*/bin:$PATH"

is_server_up() {
  curl -s -o /dev/null -m 2 "http://localhost:$PORT/api/settings"
}

# Most users won't have Node.js installed — this app is the only reason they'd need
# it. Rather than requiring a manual install first, this downloads a private,
# portable copy into server/node-runtime/ the first time it's needed. No sudo, no
# system-wide install — it only ever writes inside this app's own folder. (Mirrors
# server/launch.ps1's Get-NodeTools; keep both in sync if this changes.)
if ! command -v node >/dev/null 2>&1; then
  EXISTING_NODE=$(find "$RUNTIME_DIR" -name node -type f -perm -u+x 2>/dev/null | head -1)
  if [ -n "$EXISTING_NODE" ]; then
    export PATH="$(dirname "$EXISTING_NODE"):$PATH"
  else
    ARCH=$(uname -m)
    case "$ARCH" in
      arm64) NODE_ARCH="arm64" ;;
      *) NODE_ARCH="x64" ;;
    esac
    TARBALL="node-v$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
    URL="https://nodejs.org/dist/v$NODE_VERSION/$TARBALL"
    TMP_TARBALL="/tmp/$TARBALL"

    osascript -e 'display dialog "Node.js wasn'"'"'t found on this computer. Research App will download a private copy (about 40-50 MB, one time only) to run its local server. This won'"'"'t affect anything else on your computer.\n\nClick OK to continue — this may take a minute." with title "Research App" buttons {"OK"} default button 1 with icon note'

    mkdir -p "$RUNTIME_DIR"
    if ! curl -sL -o "$TMP_TARBALL" "$URL"; then
      osascript -e 'display dialog "Could not download Node.js. Check your internet connection, or install Node.js yourself from nodejs.org and try again." with title "Research App" buttons {"OK"} default button 1 with icon caution'
      exit 1
    fi
    tar -xzf "$TMP_TARBALL" -C "$RUNTIME_DIR"
    rm -f "$TMP_TARBALL"

    DOWNLOADED_NODE=$(find "$RUNTIME_DIR" -name node -type f -perm -u+x 2>/dev/null | head -1)
    if [ -z "$DOWNLOADED_NODE" ]; then
      osascript -e 'display dialog "The Node.js download completed but the node binary wasn'"'"'t found afterward." with title "Research App" buttons {"OK"} default button 1 with icon caution'
      exit 1
    fi
    export PATH="$(dirname "$DOWNLOADED_NODE"):$PATH"
  fi
fi

# Every open starts a genuinely fresh server — anything already on this port (a
# stale instance the heartbeat-shutdown in server.js missed, a leftover dev
# instance, etc.) is force-killed first rather than reused. The server also
# self-terminates once no open tab is heartbeating it — this is the backstop for
# whatever that missed, not the primary mechanism.
EXISTING_PID=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
  kill -9 $EXISTING_PID 2>/dev/null || true
  sleep 0.5
fi

if [ ! -d "$SERVER_DIR/node_modules" ]; then
  osascript -e 'display notification "Installing dependencies — this can take a minute…" with title "Research App"'
  (cd "$SERVER_DIR" && npm install) >> "$SERVER_DIR/install.log" 2>&1
fi

nohup node "$SERVER_DIR/server.js" >> "$SERVER_DIR/server.log" 2>&1 &

for _ in $(seq 1 20); do
  is_server_up && break
  sleep 1
done

if ! is_server_up; then
  osascript -e 'display dialog "The Research App server did not start in time.\n\nCheck server/server.log inside the app folder for errors." with title "Research App" buttons {"OK"} default button 1 with icon caution'
  exit 1
fi

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"

if [ -x "$CHROME" ]; then
  BROWSER="$CHROME"
elif [ -x "$EDGE" ]; then
  BROWSER="$EDGE"
else
  osascript -e 'display dialog "Could not find Google Chrome or Microsoft Edge.\n\nInstall one of them, then open Research App again." with title "Research App" buttons {"OK"} default button 1 with icon caution'
  exit 1
fi

exec "$BROWSER" --app="http://localhost:$PORT"
