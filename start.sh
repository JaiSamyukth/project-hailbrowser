#!/usr/bin/env sh
# HailBrowser start script (macOS / Linux). Checks GitHub for updates, then opens your browser.
# Options: --start  --update  --settings  --doctor  --no-update  --menu
# The whole script is one { } block, so the shell has read all of it before an update can
# replace this file.
{
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin"; do
    [ -x "$d/node" ] && PATH="$d:$PATH" && break
  done
fi
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "HailBrowser needs Node.js 18 or newer. Install it from https://nodejs.org and run this again."
  if command -v open >/dev/null 2>&1; then open "https://nodejs.org/en/download"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "https://nodejs.org/en/download" >/dev/null 2>&1; fi
  exit 1
fi

# Lets Node (22.21+) use HTTPS_PROXY when your network needs a proxy.
if [ -n "${HTTPS_PROXY:-}${https_proxy:-}" ]; then NODE_USE_ENV_PROXY="${NODE_USE_ENV_PROXY:-1}"; export NODE_USE_ENV_PROXY; fi
node launcher/hailbrowser.mjs "$@"
status=$?
# Keep a double-clicked window open so the messages can be read.
if [ -z "$HAILBROWSER_NO_PAUSE" ] && [ -t 0 ] && [ "$status" -ne 0 ]; then
  printf "Press Enter to close. "; read -r _
fi
exit $status
}
