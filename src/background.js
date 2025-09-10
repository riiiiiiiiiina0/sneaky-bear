// @ts-nocheck
/* global chrome */
// Tracks the tabId that currently owns Picture-in-Picture, if any
let currentPipOwnerTabId = null;

// Helper to send a message to a specific tab
async function sendMessageToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    // Ignore errors when tab is unavailable or does not have our content script
  }
}

// Listen for messages from content scripts to update PiP ownership
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'pip-status') {
    if (message.active === true && sender.tab && sender.tab.id != null) {
      currentPipOwnerTabId = sender.tab.id;
    }
    if (message.active === false) {
      currentPipOwnerTabId = null;
    }
    sendResponse({ ok: true });
    return true;
  }
});

// Handle toolbar icon click: toggle PiP
chrome.action.onClicked.addListener(async () => {
  if (currentPipOwnerTabId != null) {
    // A PiP is active somewhere → request deactivation on that tab
    await sendMessageToTab(currentPipOwnerTabId, { type: 'deactivate-pip' });
    return;
  }

  // No active PiP → activate on current active tab
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!activeTab || activeTab.id == null) {
    return;
  }

  await sendMessageToTab(activeTab.id, { type: 'activate-pip' });
});

// If the owning tab is closed or navigates, clear ownership
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === currentPipOwnerTabId) {
    currentPipOwnerTabId = null;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === currentPipOwnerTabId && changeInfo.status === 'loading') {
    currentPipOwnerTabId = null;
  }
});
