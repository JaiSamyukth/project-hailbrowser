// Live updates for an unpacked install. The launcher (start.bat / start.sh) writes
// update-stamp.json next to manifest.json after it replaces the files on disk. Chrome serves an
// unpacked extension's files straight from disk, so a stamp that differs from the one this
// extension started with means new code is waiting: reload when nothing is running.
//
// The stamp seen at load time is kept in chrome.storage.session, which survives service-worker
// restarts but is cleared by chrome.runtime.reload(), so a restarted worker does not mistake
// old code for new.

const SESSION_KEY = 'loadedUpdateStamp';
const LAST_KEY = 'lastUpdateStamp';

/** Read the stamp from disk: {id, version?, commit?, at?} or null when there is none. */
export async function readStamp() {
  try {
    const res = await fetch(chrome.runtime.getURL('update-stamp.json'), { cache: 'no-store' });
    if (!res.ok) return null;
    const stamp = await res.json();
    return stamp && typeof stamp.id === 'string' && stamp.id ? stamp : null;
  } catch {
    return null;
  }
}

/**
 * Remember which stamp this code was loaded with. Returns the stamp the previous load ran with
 * when this load is the result of an update (for a "HailBrowser was updated" notice), else null.
 */
export async function initUpdates() {
  const session = await chrome.storage.session.get(SESSION_KEY).catch(() => ({}));
  if (session[SESSION_KEY] !== undefined) return null; // worker restart, same code
  const stamp = await readStamp();
  await chrome.storage.session.set({ [SESSION_KEY]: stamp?.id || '' }).catch(() => {});
  const { [LAST_KEY]: last } = await chrome.storage.local.get(LAST_KEY);
  await chrome.storage.local.set({ [LAST_KEY]: stamp?.id || '' });
  return last !== undefined && stamp && last !== stamp.id ? stamp : null;
}

/** Reload the extension if new files are on disk and isIdle() says nothing would be cut off. */
export async function reloadIfUpdated(isIdle) {
  const stamp = await readStamp();
  if (!stamp) return false;
  const session = await chrome.storage.session.get(SESSION_KEY).catch(() => ({}));
  const loaded = session[SESSION_KEY];
  if (loaded === undefined) {
    await chrome.storage.session.set({ [SESSION_KEY]: stamp.id }).catch(() => {});
    return false;
  }
  if (loaded === stamp.id || !isIdle()) return false;
  chrome.runtime.reload();
  return true;
}
