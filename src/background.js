// Sneaky Bear PiP background service worker
// Tracks the last tab that entered PiP in session storage and reacts to the toggle-pip command

const SESSION_KEY = 'sbp_last_pip_tab_id';

async function getSessionTabId() {
  try {
    const data = await chrome.storage.session.get(SESSION_KEY);
    return data && typeof data[SESSION_KEY] !== 'undefined'
      ? data[SESSION_KEY]
      : null;
  } catch (_) {
    return null;
  }
}

async function setSessionTabId(tabId) {
  try {
    if (tabId == null) {
      await chrome.storage.session.remove(SESSION_KEY);
    } else {
      await chrome.storage.session.set({ [SESSION_KEY]: tabId });
    }
  } catch (_) {}
}

// Listen to messages from content scripts about entering/exiting PiP
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (!message || !sender || !sender.tab) return;
      const tabId = sender.tab.id;
      if (message.type === 'sbp-pip-entered') {
        await setSessionTabId(tabId);
        try {
          sendResponse({ ok: true });
        } catch (_) {}
        return;
      }
      if (message.type === 'sbp-pip-exited') {
        const current = await getSessionTabId();
        if (current === tabId) await setSessionTabId(null);
        try {
          sendResponse({ ok: true });
        } catch (_) {}
        return;
      }
    } catch (_) {}
  })();
  return true; // async
});

// Handle the keyboard shortcut command
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-pip') return;
  const tabId = await getSessionTabId();
  if (tabId == null) return;
  try {
    // Ask that tab to exit PiP and pause
    await chrome.tabs.sendMessage(tabId, { type: 'sbp-exit-pip-pause' });
  } catch (_) {}
  // Clear stored tab regardless to avoid getting stuck
  await setSessionTabId(null);
});

// Also clear the session key when a tab is closed
chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  const current = await getSessionTabId();
  if (current === closedTabId) await setSessionTabId(null);
});
