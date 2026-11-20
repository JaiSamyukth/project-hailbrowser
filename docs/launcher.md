# The start script

`start.bat` (Windows), `start.command` (macOS, double-click) and `start.sh` (macOS / Linux) all run the same launcher, `launcher/hailbrowser.mjs`. It needs Node.js 18 or newer and nothing else.

Each time you run it, it:

1. **Checks GitHub for updates** and installs them (see below).
2. **Shows a menu**: start, check for updates, settings, setup guide, coding-agent setup, health check. Press Enter to start.
3. **Opens your browser** in the profile you chose with your start pages. The first time, it also opens a setup guide and the `extension` folder, so you can add HailBrowser at `chrome://extensions` with **Load unpacked**. Chrome does not let any script add an extension to your everyday profile (or even open that page), so this one step is by hand, once.

## Options

| Command | What it does |
|---|---|
| `start` | Update check, then the menu (or straight to the browser when `showMenu` is `false`) |
| `start --start` | Update check, then open the browser without the menu |
| `start --update` | Only check for updates |
| `start --settings` | Change settings |
| `start --doctor` | Check Node, the browser, the profile, the extension and the bridge packages |
| `start --no-update` | Skip the update check this time |

## Settings

Settings live in `hailbrowser.config.json` next to the start script. It is created on first run and updates never touch it. Change it from the menu (**Settings**) or in a text editor.

| Setting | Default | Meaning |
|---|---|---|
| `browser` | `"chrome"` | `chrome`, `edge`, `brave` or `chromium` |
| `browserPath` | `""` | Full path of the browser's program file; empty finds it automatically |
| `profile` | `"Default"` | Profile folder to open (`Default`, `Profile 1`, …). The Settings menu lists your profiles by name |
| `userDataDir` | `""` | A separate browser data folder; empty uses your normal one with your logins |
| `newWindow` | `true` | Open the start pages in a new window instead of new tabs in the current one |
| `startUrls` | `["https://www.google.com"]` | Pages to open. `[]` for none |
| `showMenu` | `true` | `false` makes the start script go straight to the browser |
| `extraBrowserArgs` | `[]` | Extra command-line switches for the browser |
| `updates.check` | `"on-launch"` | `on-launch`, `ask` or `off` |
| `updates.repo` | `"JaiSamyukth/project-hailbrowser"` | GitHub repository to update from |
| `updates.branch` | `"main"` | Branch to follow |

## How updates work

- **Installed from the zip:** the launcher asks GitHub for the newest commit on the branch. If it differs from the installed one, it downloads that commit, copies the files over this folder and installs packages if they changed. Changed files are backed up first and put back if anything fails. Your settings, `node_modules` and files you added yourself are left alone.
- **A git checkout:** it runs `git fetch` and a fast-forward merge. It does nothing if you have local edits or are on a different branch.
- **The extension reloads itself.** After an update the launcher writes `extension/update-stamp.json`. The extension looks at that file every 30 seconds and reloads into the new code once no run is in progress and no coding agent has used it for a minute. You get a notification when it has updated. No trip to the extensions page is needed.

The extension has a fixed ID (`gpgloopdhooiinahamlfpffbdfobhgel`, set by `key` in `manifest.json`), so moving the folder and loading it again keeps your settings, chats and API keys. The launcher also tells the coding-agent bridge to trust the copy in this folder.

## Building the zip

```bash
npm run package        # writes dist/HailBrowser-<version>.zip
```

The zip holds the repository, the bridge's packages (so coding agents work without `npm install`) and a record of the commit it was built from.
