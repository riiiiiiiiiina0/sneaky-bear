// @ts-nocheck
/* global chrome */
/* Sneaky Bear PiP - Background Service Worker (MV3) */

let lastPlayingTabId = null; // Active tab that last reported playing video
let pipActiveTabId = null; // Tab that currently has PiP active

// Helper: run a function in a tab
async function runInTab(tabId, func, args = []) {
  try {
    return await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
    });
  } catch (_) {
    return null;
  }
}

// Page functions (executed in the tab)
function pageEnterPiP() {
  (async () => {
    const videos = Array.from(document.querySelectorAll('video'));
    const candidates = videos.filter(
      (v) => !v.paused && !v.ended && v.readyState >= 2,
    );
    const pick = (list) =>
      list.sort(
        (a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight,
      )[0];
    const target = pick(candidates) || pick(videos) || null;
    if (!target) return false;

    try {
      target.disablePictureInPicture = false;
    } catch (_) {}
    if (
      document.pictureInPictureElement &&
      document.pictureInPictureElement !== target
    ) {
      try {
        await document.exitPictureInPicture();
      } catch (_) {}
    }
    try {
      await target.requestPictureInPicture();
      return true;
    } catch (_) {
      return false;
    }
  })();
}

function pageExitPiPAndPause() {
  (async () => {
    const pipEl = /** @type {HTMLVideoElement | null} */ (
      document.pictureInPictureElement
    );
    if (pipEl) {
      try {
        await document.exitPictureInPicture();
      } catch (_) {}
      try {
        pipEl.pause();
      } catch (_) {}
      return true;
    }
    // Fallback: pause any playing videos
    const videos = Array.from(document.querySelectorAll('video'));
    const playing = /** @type {HTMLVideoElement[]} */ (videos).filter(
      (v) => !v.paused && !v.ended,
    );
    for (const v of playing) {
      try {
        v.pause();
      } catch (_) {}
    }
    return false;
  })();
}

function pageHasActivePiP() {
  try {
    return !!document.pictureInPictureElement;
  } catch (_) {
    return false;
  }
}

async function ensurePiPInTab(tabId) {
  await runInTab(tabId, pageEnterPiP);
}

async function exitPiPAndPauseInTab(tabId) {
  await runInTab(tabId, pageExitPiPAndPause);
}

async function findTabWithActivePiP() {
  try {
    const tabs = await chrome.tabs.query({
      url: ['http://*/*', 'https://*/*'],
    });
    const results = await Promise.all(
      tabs.map((t) => runInTab(t.id, pageHasActivePiP)),
    );
    for (let i = 0; i < tabs.length; i++) {
      const res = results[i];
      const first = Array.isArray(res) && res[0] ? res[0] : null;
      if (first && first.result) {
        return tabs[i].id;
      }
    }
  } catch (_) {}
  return null;
}

async function closeActivePiPIfAny() {
  let targetTabId = pipActiveTabId;
  if (!targetTabId) {
    targetTabId = await findTabWithActivePiP();
  }
  if (targetTabId != null) {
    await exitPiPAndPauseInTab(targetTabId);
  }
  lastPlayingTabId = null;
  pipActiveTabId = null;
}

// Listen for messages from content scripts about video/PiP state
chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender?.tab?.id;
  if (!tabId) return;

  switch (message.type) {
    case 'VIDEO_PLAYING': {
      if (sender.tab && sender.tab.active) {
        lastPlayingTabId = tabId;
      }
      break;
    }
    case 'VIDEO_PAUSED': {
      if (sender.tab && sender.tab.active && lastPlayingTabId === tabId) {
        lastPlayingTabId = null;
      }
      break;
    }
    case 'PIP_ENTERED': {
      pipActiveTabId = tabId;
      break;
    }
    case 'PIP_EXITED': {
      if (pipActiveTabId === tabId) {
        pipActiveTabId = null;
      }
      break;
    }
    default:
      break;
  }
});

// When active tab changes, auto-activate PiP in the last playing tab
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (lastPlayingTabId != null && lastPlayingTabId !== tabId) {
    ensurePiPInTab(lastPlayingTabId);
  }
});

// Also handle window focus changes (switching between windows)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (
      activeTab &&
      lastPlayingTabId != null &&
      lastPlayingTabId !== activeTab.id
    ) {
      ensurePiPInTab(lastPlayingTabId);
    }
  } catch (_) {}
});

// Keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-pip') {
    closeActivePiPIfAny();
  }
});

// Toolbar button
chrome.action.onClicked.addListener(() => {
  closeActivePiPIfAny();
});
