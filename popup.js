/**
 * WA Group Member Exporter - Popup Controller
 * Manages user interactions, tab communication, live progress updates, and data exports.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // UI Elements
  const websiteWarning = document.getElementById('websiteWarning');
  const warningText = document.getElementById('warningText');
  const btnOpenWhatsApp = document.getElementById('btnOpenWhatsApp');

  const groupTitle = document.getElementById('groupTitle');
  const groupMeta = document.getElementById('groupMeta');
  const btnDetectGroupInline = document.getElementById('btnDetectGroupInline');

  const statusBadge = document.getElementById('statusBadge');
  const statusLabel = document.getElementById('statusLabel');
  const statusMessage = document.getElementById('statusMessage');

  const participantsFound = document.getElementById('participantsFound');
  const totalCountWrapper = document.getElementById('totalCountWrapper');
  const totalCountEl = document.getElementById('totalCount');
  const progressBar = document.getElementById('progressBar');

  const primaryActionsContainer = document.querySelector('.primary-actions');
  const btnDetectGroup = document.getElementById('btnDetectGroup');
  const btnExtract = document.getElementById('btnExtract');
  const btnStop = document.getElementById('btnStop');

  const btnExportCSV = document.getElementById('btnExportCSV');
  const btnExportXLSX = document.getElementById('btnExportXLSX');
  const btnCopy = document.getElementById('btnCopy');
  const btnClear = document.getElementById('btnClear');

  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');

  // Local state
  let currentTabId = null;
  let isWhatsAppTab = false;
  let activeGroupName = 'WhatsApp_Group';
  let participants = [];
  let isRunning = false;
  let totalParticipantsCount = null;
  let toastTimer = null;

  /**
   * Display a temporary floating toast message.
   * @param {string} msg 
   * @param {number} [duration] 
   */
  function showToast(msg, duration = 2400) {
    if (!toast || !toastMessage) return;
    toastMessage.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, duration);
  }

  /**
   * Updates the status badge UI.
   * @param {'ready'|'extracting'|'completed'|'stopped'|'error'} type 
   * @param {string} label 
   * @param {string} message 
   */
  function setStatus(type, label, message) {
    statusBadge.className = 'status-badge';
    statusBadge.classList.add(`status-${type}`);
    statusLabel.textContent = label;
    if (message) {
      statusMessage.textContent = message;
    }
  }

  /**
   * Enables or disables export/action buttons based on participant count.
   */
  function updateButtonStates() {
    const hasData = participants.length > 0;
    btnExportCSV.disabled = !hasData;
    btnExportXLSX.disabled = !hasData;
    btnCopy.disabled = !hasData;
    btnClear.disabled = !hasData && !isRunning;

    if (isRunning) {
      btnExtract.classList.add('hidden');
      btnStop.classList.remove('hidden');
      primaryActionsContainer.classList.add('has-stop');
      btnDetectGroup.disabled = true;
      btnDetectGroupInline.disabled = true;
    } else {
      btnExtract.classList.remove('hidden');
      btnStop.classList.add('hidden');
      primaryActionsContainer.classList.remove('has-stop');
      btnDetectGroup.disabled = !isWhatsAppTab;
      btnDetectGroupInline.disabled = !isWhatsAppTab;
      btnExtract.disabled = !isWhatsAppTab;
    }
  }

  /**
   * Updates progress counter and bar.
   * @param {number} count 
   * @param {number|null} total 
   */
  function updateProgress(count, total) {
    participantsFound.textContent = count.toLocaleString();

    if (total && total > 0) {
      totalCountWrapper.classList.remove('hidden');
      totalCountEl.textContent = total.toLocaleString();
      progressBar.classList.remove('indeterminate');
      const pct = Math.min(100, Math.max(5, Math.round((count / total) * 100)));
      progressBar.style.width = `${pct}%`;
    } else {
      totalCountWrapper.classList.add('hidden');
      if (isRunning) {
        progressBar.classList.add('indeterminate');
      } else {
        progressBar.classList.remove('indeterminate');
        progressBar.style.width = count > 0 ? '100%' : '0%';
      }
    }
  }

  /**
   * Queries active tab to ensure it is WhatsApp Web.
   */
  async function checkActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        showTabWarning('Please open WhatsApp Web first.');
        return false;
      }

      currentTabId = tab.id;
      const isWA = tab.url.startsWith('https://web.whatsapp.com') || tab.url.includes('web.whatsapp.com');

      if (!isWA) {
        showTabWarning('Please open WhatsApp Web first.');
        isWhatsAppTab = false;
        updateButtonStates();
        return false;
      }

      // WhatsApp Web is open
      isWhatsAppTab = true;
      websiteWarning.classList.add('hidden');
      updateButtonStates();
      return true;
    } catch (e) {
      console.error('[Popup] Error checking tab:', e);
      showTabWarning('Could not inspect the active tab.');
      return false;
    }
  }

  function showTabWarning(msg) {
    warningText.textContent = msg;
    websiteWarning.classList.remove('hidden');
    isWhatsAppTab = false;
    btnDetectGroup.disabled = true;
    btnExtract.disabled = true;
  }

  /**
   * Sends a message to the content script in the active tab with error handling.
   * Injects content scripts if the page was opened before extension installation.
   * @param {object} message 
   * @returns {Promise<any>}
   */
  async function sendMessageToTab(message) {
    if (!currentTabId) {
      throw new Error('No active WhatsApp Web tab.');
    }

    try {
      return await chrome.tabs.sendMessage(currentTabId, message);
    } catch (err) {
      // Content script might not be injected yet (e.g. extension loaded after page)
      console.warn('[Popup] Content script not responding. Attempting injection...', err);
      try {
        await chrome.scripting.executeScript({
          target: { tabId: currentTabId },
          files: ['exporter.js', 'content.js']
        });
        // Small delay to allow script initialization
        await new Promise((r) => setTimeout(r, 200));
        return await chrome.tabs.sendMessage(currentTabId, message);
      } catch (injectionErr) {
        console.error('[Popup] Failed to inject content script:', injectionErr);
        throw new Error('Could not communicate with WhatsApp Web. Please refresh the WhatsApp Web page.');
      }
    }
  }

  /**
   * Synchronizes UI with cached state in chrome.storage.local.
   */
  function restoreSavedState() {
    chrome.storage.local.get([
      'currentGroup',
      'totalCount',
      'participants',
      'extractionStatus',
      'statusMessage'
    ], (data) => {
      if (data.currentGroup) {
        activeGroupName = data.currentGroup;
        groupTitle.textContent = data.currentGroup;
        groupMeta.textContent = 'Active group';
      }

      if (Array.isArray(data.participants)) {
        participants = data.participants;
      }

      totalParticipantsCount = data.totalCount || null;
      updateProgress(participants.length, totalParticipantsCount);

      if (data.extractionStatus === 'extracting') {
        isRunning = true;
        setStatus('extracting', 'Extracting...', data.statusMessage || 'Extracting participants...');
      } else if (data.extractionStatus === 'completed') {
        isRunning = false;
        setStatus('completed', 'Completed', data.statusMessage || `Completed. ${participants.length} participants.`);
      } else if (data.extractionStatus === 'stopped') {
        isRunning = false;
        setStatus('stopped', 'Stopped', data.statusMessage || `Stopped. ${participants.length} participants.`);
      } else if (data.extractionStatus === 'error') {
        isRunning = false;
        setStatus('error', 'Error', data.statusMessage || 'An error occurred.');
      } else {
        isRunning = false;
        setStatus('ready', 'Ready', 'Ready to extract');
      }

      updateButtonStates();
    });
  }

  /**
   * Action: Detect current group
   */
  async function handleDetectGroup() {
    if (!isWhatsAppTab) {
      showToast('Please open WhatsApp Web first.');
      return;
    }

    setStatus('ready', 'Detecting...', 'Inspecting active WhatsApp chat...');
    try {
      const response = await sendMessageToTab({ action: 'DETECT_GROUP' });
      if (response && response.success && response.groupName) {
        activeGroupName = response.groupName;
        groupTitle.textContent = response.groupName;
        totalParticipantsCount = response.totalCount || null;

        if (totalParticipantsCount) {
          groupMeta.textContent = `Group detected • ~${totalParticipantsCount} members`;
          updateProgress(participants.length, totalParticipantsCount);
        } else {
          groupMeta.textContent = 'Group detected';
        }

        setStatus('ready', 'Ready', `Detected "${response.groupName}". Ready to extract.`);
        showToast(`Detected: ${response.groupName}`);
      } else {
        groupTitle.textContent = 'Not detected';
        groupMeta.textContent = 'Please open a group chat first';
        setStatus('ready', 'Ready', response?.error || 'Open a WhatsApp group first.');
        showToast(response?.error || 'Open a WhatsApp group first.');
      }
    } catch (err) {
      setStatus('error', 'Error', err.message);
      showToast(err.message, 3200);
    }
  }

  /**
   * Action: Start extraction
   */
  async function handleStartExtraction() {
    if (!isWhatsAppTab) {
      showToast('Please open WhatsApp Web first.');
      return;
    }

    isRunning = true;
    updateButtonStates();
    setStatus('extracting', 'Starting...', 'Initializing participant extraction...');
    progressBar.classList.add('indeterminate');

    try {
      const response = await sendMessageToTab({ action: 'START_EXTRACTION' });
      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to start extraction.');
      }
    } catch (err) {
      isRunning = false;
      updateButtonStates();
      setStatus('error', 'Error', err.message);
      showToast(err.message, 3500);
    }
  }

  /**
   * Action: Stop extraction
   */
  async function handleStopExtraction() {
    try {
      btnStop.disabled = true;
      setStatus('stopped', 'Stopping...', 'Halting extraction...');
      await sendMessageToTab({ action: 'STOP_EXTRACTION' });
      showToast('Extraction stopping...');
    } catch (err) {
      console.error('[Popup] Stop error:', err);
    } finally {
      btnStop.disabled = false;
    }
  }

  /**
   * Action: Export CSV
   */
  function handleExportCSV() {
    if (!participants || participants.length === 0) {
      showToast('No participants were detected to export.');
      return;
    }

    try {
      const filename = WAExporter.exportToCSV(participants, activeGroupName);
      showToast(`Exported CSV: ${filename}`, 3000);
    } catch (err) {
      console.error('[Popup] CSV export failed:', err);
      showToast(`CSV Export Error: ${err.message}`, 3000);
    }
  }

  /**
   * Action: Export XLSX
   */
  function handleExportXLSX() {
    if (!participants || participants.length === 0) {
      showToast('No participants were detected to export.');
      return;
    }

    try {
      const filename = WAExporter.exportToXLSX(participants, activeGroupName);
      showToast(`Exported XLSX: ${filename}`, 3000);
    } catch (err) {
      console.error('[Popup] XLSX export failed:', err);
      showToast(`XLSX Export Error: ${err.message}`, 3000);
    }
  }

  /**
   * Action: Copy to clipboard (TSV format)
   */
  async function handleCopy() {
    if (!participants || participants.length === 0) {
      showToast('No participants to copy.');
      return;
    }

    try {
      const count = await WAExporter.copyToClipboard(participants);
      showToast(`Copied ${count} participants to clipboard!`, 2500);
    } catch (err) {
      console.error('[Popup] Clipboard copy failed:', err);
      showToast(`Copy failed: ${err.message}`, 2500);
    }
  }

  /**
   * Action: Clear collected data
   */
  async function handleClearData() {
    if (participants.length === 0) return;

    participants = [];
    totalParticipantsCount = null;
    isRunning = false;
    activeGroupName = 'WhatsApp_Group';

    groupTitle.textContent = 'Not detected';
    groupMeta.textContent = 'Open a group in WhatsApp Web';
    updateProgress(0, null);
    setStatus('ready', 'Ready', 'Data cleared. Ready to extract.');
    updateButtonStates();

    try {
      await sendMessageToTab({ action: 'CLEAR_DATA' });
    } catch (e) {
      // Ignored if tab not active
    }

    showToast('Extracted data cleared.');
  }

  /**
   * Listen for background or content script live progress updates.
   */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'EXTRACTION_PROGRESS') {
      if (msg.currentGroup) {
        activeGroupName = msg.currentGroup;
        groupTitle.textContent = msg.currentGroup;
        groupMeta.textContent = 'Active group';
      }

      if (Array.isArray(msg.participants)) {
        participants = msg.participants;
      }

      totalParticipantsCount = msg.totalCount || totalParticipantsCount;
      updateProgress(msg.count ?? participants.length, totalParticipantsCount);

      if (msg.status === 'extracting' || msg.status === 'opening_list' || msg.status === 'scrolling_list') {
        isRunning = true;
        setStatus('extracting', 'Extracting...', msg.statusMessage);
      } else if (msg.status === 'completed') {
        isRunning = false;
        setStatus('completed', 'Completed', msg.statusMessage);
        showToast(`Extraction complete! ${participants.length} participants.`);
      } else if (msg.status === 'stopped') {
        isRunning = false;
        setStatus('stopped', 'Stopped', msg.statusMessage);
        showToast(`Stopped. ${participants.length} participants collected.`);
      } else if (msg.status === 'error') {
        isRunning = false;
        setStatus('error', 'Error', msg.statusMessage);
        showToast(msg.statusMessage, 3500);
      }

      updateButtonStates();
    }
  });

  // Attach Event Listeners
  btnDetectGroup.addEventListener('click', handleDetectGroup);
  btnDetectGroupInline.addEventListener('click', handleDetectGroup);
  btnExtract.addEventListener('click', handleStartExtraction);
  btnStop.addEventListener('click', handleStopExtraction);
  btnExportCSV.addEventListener('click', handleExportCSV);
  btnExportXLSX.addEventListener('click', handleExportXLSX);
  btnCopy.addEventListener('click', handleCopy);
  btnClear.addEventListener('click', handleClearData);

  btnOpenWhatsApp.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
  });

  // Initialization
  restoreSavedState();
  checkActiveTab().then((isWA) => {
    if (isWA) {
      // Auto-detect group if one is already open
      handleDetectGroup();
    }
  });
});
