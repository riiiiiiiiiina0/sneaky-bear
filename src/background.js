// @ts-nocheck
/* global chrome */
// Tracks the tabId that currently owns Picture-in-Picture, if any
let currentPipOwnerTabId = null;

const STORAGE_KEY = 'pipOwnerTabId';

async function saveOwnerToSession(tabId) {
  try {
    if (chrome?.storage?.session) {
      await chrome.storage.session.set({ [STORAGE_KEY]: tabId });
    }
  } catch (_) {}
}

async function clearOwnerFromSession() {
  try {
    if (chrome?.storage?.session) {
      await chrome.storage.session.remove(STORAGE_KEY);
    }
  } catch (_) {}
}

async function restoreOwnerFromSession() {
  try {
    if (!chrome?.storage?.session) return null;
    const obj = await chrome.storage.session.get(STORAGE_KEY);
    const stored = obj && obj[STORAGE_KEY];
    if (typeof stored === 'number') {
      currentPipOwnerTabId = stored;
      return stored;
    }
  } catch (_) {}
  return null;
}

async function getKnownActivePipTabId() {
  if (currentPipOwnerTabId != null) return currentPipOwnerTabId;
  const restored = await restoreOwnerFromSession();
  if (restored != null) {
    // Verify it's still actually active; otherwise fall back to a scan
    try {
      const response = await chrome.tabs.sendMessage(restored, {
        type: 'query-pip-state',
      });
      if (response && response.active === true) {
        return restored;
      }
    } catch (_) {}
  }
  const scanned = await queryAnyActivePipTabId();
  if (scanned != null) {
    currentPipOwnerTabId = scanned;
    await saveOwnerToSession(scanned);
  }
  return scanned;
}

// On service worker startup, opportunistically restore last known owner
(async () => {
  await restoreOwnerFromSession();
})();

// Helper to send a message to a specific tab
async function sendMessageToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    // Ignore errors when tab is unavailable or does not have our content script
  }
}

async function queryAnyActivePipTabId() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id == null) continue;
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'query-pip-state',
        });
        if (response && response.active === true) {
          return tab.id;
        }
      } catch (_) {
        // ignore tabs without our content script or unreachable
      }
    }
  } catch (_) {
    // ignore
  }
  return null;
}

async function togglePiP(invocationTab) {
  // If we believe PiP is active somewhere already, deactivate immediately
  const knownActiveTabId = await getKnownActivePipTabId();
  if (knownActiveTabId != null) {
    await sendMessageToTab(knownActiveTabId, { type: 'deactivate-pip' });
    currentPipOwnerTabId = null;
    await clearOwnerFromSession();
    return;
  }

  // Determine target tab. Prefer the tab from the user action callback to retain user activation
  let targetTab = invocationTab;
  if (!targetTab || targetTab.id == null) {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    targetTab = activeTab;
  }
  if (!targetTab || targetTab.id == null) {
    return;
  }
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id, allFrames: true },
      world: 'MAIN',
      func: () => {
        return (async () => {
          try {
            const candidates = Array.from(
              document.querySelectorAll('video'),
            ).filter((v) => !v.disablePictureInPicture);
            if (candidates.length === 0) {
              return { ok: false, reason: 'no-video' };
            }
            const getSorted = () => {
              const withScores = candidates.map((v) => {
                const rect = v.getBoundingClientRect();
                const area = Math.max(0, rect.width) * Math.max(0, rect.height);
                const isVisible =
                  area > 0 &&
                  rect.bottom > 0 &&
                  rect.right > 0 &&
                  rect.top < window.innerHeight &&
                  rect.left < window.innerWidth;
                const isPlaying = !v.paused && !v.ended && v.readyState > 2;
                const score =
                  (isVisible ? 2 : 0) + (isPlaying ? 3 : 0) + area / 10000;
                return { v, score, isVisible };
              });
              const visible = withScores.filter((x) => x.isVisible);
              const pool = visible.length ? visible : withScores;
              pool.sort((a, b) => b.score - a.score);
              return pool.map((x) => x.v);
            };
            const sorted = getSorted();
            if (sorted.length === 0) {
              return { ok: false, reason: 'no-video' };
            }
            const waitForPlaying = (v, timeoutMs = 800) =>
              new Promise((resolve) => {
                let done = false;
                const cleanup = () => {
                  v.removeEventListener('playing', onPlaying, true);
                  v.removeEventListener('timeupdate', onTimeUpdate, true);
                  v.removeEventListener('canplay', onCanPlay, true);
                  clearTimeout(timer);
                };
                const onPlaying = () => {
                  if (done) return;
                  done = true;
                  cleanup();
                  resolve(true);
                };
                const onTimeUpdate = () => {
                  if (done) return;
                  if (v.currentTime > 0) {
                    done = true;
                    cleanup();
                    resolve(true);
                  }
                };
                const onCanPlay = () => {
                  if (done) return;
                  requestAnimationFrame(() => {
                    if (!done) {
                      done = true;
                      cleanup();
                      resolve(true);
                    }
                  });
                };
                const timer = setTimeout(() => {
                  if (done) return;
                  done = true;
                  cleanup();
                  resolve(false);
                }, timeoutMs);
                v.addEventListener('playing', onPlaying, true);
                v.addEventListener('timeupdate', onTimeUpdate, true);
                v.addEventListener('canplay', onCanPlay, true);
              });

            for (const video of sorted) {
              let startedByUs = false;
              const wasMuted = video.muted;
              try {
                try {
                  await video.requestPictureInPicture();
                  return { ok: true };
                } catch (e1) {
                  video.playsInline = true;
                  video.muted = true;
                  await video.play();
                  startedByUs = true;
                  await waitForPlaying(video);
                  await video.requestPictureInPicture();
                  return { ok: true };
                }
              } catch (_) {
                try {
                  if (startedByUs) video.pause();
                } catch (_) {}
              } finally {
                try {
                  if (!wasMuted) video.muted = false;
                } catch (_) {}
              }
            }
            return { ok: false, reason: 'request-failed' };
          } catch (err) {
            return {
              ok: false,
              reason: 'exception',
              message: (err && err.message) || String(err),
            };
          }
        })();
      },
    });
    const anyOk =
      Array.isArray(results) &&
      results.some((r) => r && r.result && r.result.ok);
    if (!anyOk) {
      await sendMessageToTab(targetTab.id, { type: 'activate-pip' });
    } else {
      // We activated PiP via direct script; record ownership immediately
      currentPipOwnerTabId = targetTab.id;
      await saveOwnerToSession(currentPipOwnerTabId);
    }
  } catch (_) {
    await sendMessageToTab(targetTab.id, { type: 'activate-pip' });
  }
}

// Listen for messages from content scripts to update PiP ownership
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'pip-status') {
    if (message.active === true && sender.tab && sender.tab.id != null) {
      currentPipOwnerTabId = sender.tab.id;
      saveOwnerToSession(currentPipOwnerTabId);
    }
    if (message.active === false) {
      currentPipOwnerTabId = null;
      clearOwnerFromSession();
    }
    sendResponse({ ok: true });
    return true;
  }
});

// Handle toolbar icon click: toggle PiP (pass the clicked tab)
chrome.action.onClicked.addListener((tab) => togglePiP(tab));

// Handle global keyboard shortcut command
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-pip') {
    await togglePiP();
  }
});

// If the owning tab is closed or navigates, clear ownership
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentPipOwnerTabId) {
    currentPipOwnerTabId = null;
    clearOwnerFromSession();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === currentPipOwnerTabId && changeInfo.status === 'loading') {
    currentPipOwnerTabId = null;
    clearOwnerFromSession();
  }
});
