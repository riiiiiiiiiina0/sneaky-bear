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
async function pageEnterPiP() {
  // console.log('[Sneaky Bear] pageEnterPiP');
  const videos = Array.from(document.querySelectorAll('video'));
  // console.log('[Sneaky Bear] videos', videos);
  const candidates = videos.filter(
    (v) => !v.paused && !v.ended && v.readyState >= 2,
  );
  // console.log('[Sneaky Bear] candidates', candidates);
  const pick = (list) =>
    list.sort(
      (a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight,
    )[0];
  const target = pick(candidates) || pick(videos) || null;
  // console.log('[Sneaky Bear] target', target);
  if (!target) return { ok: false, error: 'NoVideo' };

  // console.log('[Sneaky Bear] ensure pip enabled');
  try {
    target.disablePictureInPicture = false;
  } catch (_) {}

  // console.log('[Sneaky Bear] exit pip if any');
  if (
    document.pictureInPictureElement &&
    document.pictureInPictureElement !== target
  ) {
    try {
      await document.exitPictureInPicture();
    } catch (_) {}
  }

  // console.log('[Sneaky Bear] request picture in picture');
  try {
    const result = await target.requestPictureInPicture();
    // console.log('[Sneaky Bear] requestPictureInPicture', result);
    return { ok: true };
  } catch (err) {
    // console.log('[Sneaky Bear] requestPictureInPicture error', err);
    const name = err && err.name ? err.name : 'Error';
    return { ok: false, error: name };
  }
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

function pageHasUserActivation() {
  try {
    const ua = navigator.userActivation;
    // hasBeenActive stays true after any gesture; isActive is transient
    return !!(ua && (ua.isActive || ua.hasBeenActive));
  } catch (_) {
    return false;
  }
}

async function ensurePiPInTab(tabId) {
  // console.log('[Sneaky Bear] ensurePiPInTab', tabId);
  const res = await runInTab(tabId, pageEnterPiP);
  const data = Array.isArray(res) && res[0] ? res[0].result : null;
  return !!(data && data.ok);
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

async function clearBadgeText() {
  try {
    await chrome.action.setBadgeText({ text: '' });
  } catch (_) {}
}

async function setBadgeText(text, color, clearTimeout = 0) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    if (clearTimeout > 0) {
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
      }, clearTimeout);
    }
  } catch (_) {}
}

async function togglePiP() {
  // If there is active PiP, close it and pause
  const existing = await findTabWithActivePiP();
  if (existing != null) {
    await exitPiPAndPauseInTab(existing);
    lastPlayingTabId = null;
    pipActiveTabId = null;
    await clearBadgeText();
    return;
  }

  // Otherwise try the last known playing tab or fallback to current active
  let target = lastPlayingTabId;
  if (target == null) {
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (activeTab) target = activeTab.id;
    } catch (_) {}
  }
  if (target != null) {
    const ok = await ensurePiPInTab(target);
    if (!ok) {
      // If it failed due to lack of activation, hint the user
      await setBadgeText('👆', '#F44336', 2000);
    } else {
      await clearBadgeText();
    }
  }
}

// Listen for messages from content scripts about video/PiP state
chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender?.tab?.id;
  if (!tabId) return;

  switch (message.type) {
    case 'VIDEO_PLAYING': {
      if (sender.tab && sender.tab.active) {
        // console.log('[Sneaky Bear] lastPlayingTabId', tabId);
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
    // Only attempt auto-PiP if the source tab had a gesture; otherwise it will be blocked
    runInTab(lastPlayingTabId, pageHasUserActivation).then((res) => {
      const hasUA = Array.isArray(res) && res[0] ? !!res[0].result : false;
      if (hasUA) {
        ensurePiPInTab(lastPlayingTabId);
      } else {
        setBadgeText('👆', '#F44336', 2000);
      }
    });
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
      const res = await runInTab(lastPlayingTabId, pageHasUserActivation);
      const hasUA = Array.isArray(res) && res[0] ? !!res[0].result : false;
      if (hasUA) {
        ensurePiPInTab(lastPlayingTabId);
      } else {
        setBadgeText('👆', '#F44336', 2000);
      }
    }
  } catch (_) {}
});

// Keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-pip') {
    togglePiP();
  }
});

// Toolbar button
chrome.action.onClicked.addListener(() => {
  togglePiP();
});
