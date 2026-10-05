/**
 * WA Group Member Exporter - Background Service Worker
 * Handles lifecycle events, default storage initialization, and local state management.
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      currentGroup: null,
      totalCount: null,
      participants: [],
      extractionStatus: 'ready',
      statusMessage: 'Ready to extract',
      lastUpdated: Date.now()
    }, () => {
      console.log('[WA Exporter Background] Installed & initialized local storage.');
    });
  }
});

// Listener for runtime messages (optional relaying or diagnostics)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PING') {
    sendResponse({ status: 'alive' });
    return true;
  }
  return false;
});
