/**
 * WA Group Member Exporter - Content Script
 * Runs in the context of WhatsApp Web (https://web.whatsapp.com/*).
 * Safely inspects visible DOM elements, scrolls virtualized participant lists,
 * and extracts participant information without limits.
 */

(function () {
  'use strict';

  const DEBUG = true;

  function log(...args) {
    if (DEBUG) {
      console.log('[WA Exporter]', ...args);
    }
  }

  function warn(...args) {
    console.warn('[WA Exporter Warning]', ...args);
  }

  function errorLog(...args) {
    console.error('[WA Exporter Error]', ...args);
  }

  // Multi-tier Fallback Selectors
  const SELECTORS = {
    chatMain: [
      '#main',
      'div[data-testid="conversation-panel-wrapper"]',
      'div[role="region"][aria-label*="chat" i]',
      'div[role="region"]'
    ],
    conversationHeader: [
      '#main header',
      'header[data-testid="conversation-header"]',
      'div[data-testid="conversation-header"]',
      'header'
    ],
    groupTitle: [
      '#main header [data-testid="conversation-info-header-chat-title"]',
      '#main header span[title]',
      'header [data-testid="conversation-info-header-chat-title"]',
      'header span[title]',
      '#main header h2',
      'header h2'
    ],
    groupInfoDrawer: [
      'div[data-testid="chat-info-drawer"]',
      'div[aria-label="Group info"]',
      'section[aria-label="Group info"]',
      'div[aria-label="Chat details"]',
      'div[aria-label="Contact info"]',
      'div[role="region"][aria-label*="info" i]'
    ],
    viewAllButtons: [
      'button[data-testid="group-members-view-all"]',
      'div[data-testid="group-members-view-all"]',
      '[data-testid="group-info-members-view-all"]',
      'div[role="button"][aria-label*="more" i]',
      'button[aria-label*="more" i]',
      'div[role="button"][aria-label*="view all" i]',
      'button[aria-label*="view all" i]'
    ],
    membersModal: [
      'div[data-testid="group-members-modal"]',
      'div[role="dialog"][aria-label*="member" i]',
      'div[role="dialog"][aria-label*="participant" i]',
      'div[role="dialog"][aria-label*="search" i]',
      'div[aria-label*="Search members" i]',
      'div[aria-label*="Group members" i]'
    ],
    participantContainer: [
      'div[data-testid="group-members-list"]',
      'div[data-testid="community-members-list"]'
    ],
    participantRow: [
      'div[data-testid="cell-frame-container"]',
      'div[role="listitem"]',
      'div[data-testid^="list-item-"]',
      'div[data-testid="contact-list-item"]',
      'div[data-testid*="user-list"]',
      'div[role="button"][tabindex="-1"]',
      'div[class*="_ak8l"]',
      'div[class*="_ak72"]'
    ],
    adminBadge: [
      '[data-testid="admin-tag"]',
      '[data-testid="group-admin-tag"]',
      'span[title="Group admin"]',
      'span[title="Community admin"]'
    ]
  };

  // State
  let currentGroup = null;
  let detectedTotal = null;
  let participantsMap = new Map();
  let isExtracting = false;
  let extractionCancelled = false;

  /**
   * Safe DOM element finder using fallback selector list.
   * @param {string[]} selectorList 
   * @param {Element|Document} root 
   * @returns {Element|null}
   */
  function queryFirst(selectorList, root = document) {
    if (!selectorList || !Array.isArray(selectorList)) return null;
    for (const sel of selectorList) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (e) {
        // Ignore invalid selector syntax
      }
    }
    return null;
  }

  /**
   * Safe DOM element list finder using fallback selector list.
   * @param {string[]} selectorList 
   * @param {Element|Document} root 
   * @returns {Element[]}
   */
  function queryAll(selectorList, root = document) {
    if (!selectorList || !Array.isArray(selectorList)) return [];
    for (const sel of selectorList) {
      try {
        const list = root.querySelectorAll(sel);
        if (list && list.length > 0) return Array.from(list);
      } catch (e) {
        // Ignore
      }
    }
    return [];
  }

  /**
   * Wait asynchronously for an element matching any selector in list.
   * @param {string[]} selectorList 
   * @param {number} timeoutMs 
   * @param {Element|Document} root 
   * @returns {Promise<Element|null>}
   */
  function waitForElement(selectorList, timeoutMs = 8000, root = document) {
    return new Promise((resolve) => {
      const existing = queryFirst(selectorList, root);
      if (existing) {
        return resolve(existing);
      }

      let timeoutId;
      const observer = new MutationObserver(() => {
        const el = queryFirst(selectorList, root);
        if (el) {
          clearTimeout(timeoutId);
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(root === document ? document.body : root, {
        childList: true,
        subtree: true
      });

      timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve(queryFirst(selectorList, root));
      }, timeoutMs);
    });
  }

  /**
   * Wait for a custom condition to become true.
   * @param {() => any} predicate 
   * @param {number} timeoutMs 
   * @param {number} intervalMs 
   * @returns {Promise<any>}
   */
  function waitForCondition(predicate, timeoutMs = 6000, intervalMs = 200) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const intervalId = setInterval(() => {
        try {
          const result = predicate();
          if (result) {
            clearInterval(intervalId);
            return resolve(result);
          }
        } catch (e) {}

        if (Date.now() - startTime >= timeoutMs) {
          clearInterval(intervalId);
          resolve(null);
        }
      }, intervalMs);
    });
  }

  /**
   * Sleep helper.
   * @param {number} ms 
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Finds the active chat header.
   * @returns {Element|null}
   */
  function findConversationHeader() {
    const main = queryFirst(SELECTORS.chatMain);
    if (main) {
      const header = queryFirst(SELECTORS.conversationHeader, main);
      if (header) return header;
    }
    return queryFirst(SELECTORS.conversationHeader);
  }

  /**
   * Detects the currently opened group name and verifies if it is a group.
   * @returns {{ groupName: string|null, isGroup: boolean }}
   */
  function detectGroup() {
    const header = findConversationHeader();
    if (!header) {
      log('No conversation header found.');
      return { groupName: null, isGroup: false };
    }

    // Try finding title element
    let titleEl = queryFirst(SELECTORS.groupTitle, header);
    let title = null;

    if (titleEl) {
      title = titleEl.getAttribute('title') || titleEl.innerText || titleEl.textContent;
    }

    // Fallback: look for spans with title in header
    if (!title) {
      const candidateSpans = header.querySelectorAll('span[title]');
      for (const s of candidateSpans) {
        const t = s.getAttribute('title');
        if (t && t.length > 0 && !t.includes(':') && !t.includes('click here')) {
          title = t;
          break;
        }
      }
    }

    // Fallback: look for prominent heading
    if (!title) {
      const h2 = header.querySelector('h2');
      if (h2) {
        title = h2.innerText || h2.textContent;
      }
    }

    if (title) {
      title = WAExporter.cleanName(title);
    }

    // Check if it's a group: groups usually show subtitle with members or 'click here for group info'
    const headerText = (header.innerText || header.textContent || '').toLowerCase();
    const isGroup = headerText.includes('click here for group info') ||
                    headerText.includes('tap here for group info') ||
                    headerText.includes(',') || // participant list in subtitle
                    headerText.includes('group') ||
                    headerText.includes('members') ||
                    headerText.includes('participants') ||
                    Boolean(document.querySelector('[data-testid="chat-info-drawer"]'));

    log(`Group detected: "${title}", isGroup: ${isGroup}`);
    currentGroup = title;
    return { groupName: title, isGroup };
  }

  /**
   * Accurately detects whether a "Search members" or Group members modal is already open.
   * @returns {Element|null}
   */
  function findOpenMembersModal() {
    const dialogs = document.querySelectorAll('div[role="dialog"], div[data-testid="group-members-modal"]');
    for (const dialog of dialogs) {
      const rect = dialog.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 200) { // visible on screen
        const text = (dialog.innerText || dialog.textContent || '').toLowerCase();
        const hasMemberKeyword = text.includes('search members') || 
                                 text.includes('group members') || 
                                 text.includes('search contacts') ||
                                 text.includes('members') || 
                                 text.includes('participants');
        
        const hasRows = findAllParticipantRows(dialog).length > 0;

        if (hasMemberKeyword || hasRows) {
          log('Confirmed open participant modal:', dialog);
          return dialog;
        }
      }
    }
    return null;
  }

  /**
   * Opens the right-side Group Info drawer if not already open.
   * @returns {Promise<Element|null>}
   */
  async function openGroupInfoPanel() {
    let drawer = queryFirst(SELECTORS.groupInfoDrawer);
    if (drawer && drawer.offsetParent !== null) {
      log('Group info panel is already open.');
      return drawer;
    }

    const header = findConversationHeader();
    if (!header) {
      throw new Error('Conversation header not found. Please ensure a group chat is open.');
    }

    log('Opening group info panel by clicking chat header...');
    // Target the title/avatar area specifically, avoiding right-side action icons (search/call)
    const titleArea = queryFirst(SELECTORS.groupTitle, header) ||
                      header.querySelector('[data-testid="conversation-info-header"]') ||
                      header.querySelector('div[style*="cursor: pointer"]') ||
                      header;

    titleArea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    titleArea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    titleArea.click();

    drawer = await waitForElement(SELECTORS.groupInfoDrawer, 5000);
    if (!drawer) {
      // Retry clicking
      titleArea.click();
      drawer = await waitForElement(SELECTORS.groupInfoDrawer, 4000);
    }

    if (!drawer) {
      throw new Error('Could not open Group Info panel. WhatsApp Web may have changed its interface.');
    }

    log('Group info panel successfully opened.');
    await sleep(600); // Allow drawer content to render
    return drawer;
  }

  /**
   * Attempts to detect the total participant count from group info or modal.
   * Never fakes a count; returns null if not safely detected.
   * @param {Element} [container] 
   * @returns {number|null}
   */
  function detectTotalCount(container = document) {
    const textSources = [];

    const drawer = queryFirst(SELECTORS.groupInfoDrawer, container) || container;
    if (drawer) {
      const headings = drawer.querySelectorAll('span, div, h2, h3, p');
      for (const h of headings) {
        const txt = (h.innerText || h.textContent || '').trim();
        if (txt.length > 0 && txt.length < 50) {
          textSources.push(txt);
        }
      }
    }

    // RegEx patterns for total count: "145 members", "145 participants", "(145)", "Members: 145"
    const countPatterns = [
      /([0-9,.]+)\s*(?:members|participants|membros|participantes|membres|mitglieder)/i,
      /(?:members|participants|membros|participantes|membres|mitglieder)[:\s]+([0-9,.]+)/i,
      /\(\s*([0-9,.]+)\s*(?:members|participants)?\s*\)/i
    ];

    for (const text of textSources) {
      for (const pattern of countPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const numStr = match[1].replace(/[,.]/g, '');
          const count = parseInt(numStr, 10);
          if (!isNaN(count) && count > 0 && count < 100000) {
            log(`Safely detected total count: ${count} from text: "${text}"`);
            detectedTotal = count;
            return count;
          }
        }
      }
    }

    log('Total participant count could not be safely determined.');
    return null;
  }

  /**
   * Clicks the "View all" / "X more" button if present to open the full participant modal.
   * @param {Element} drawer 
   * @returns {Promise<Element|null>} The modal or drawer containing participants
   */
  async function openFullMembersList(drawer) {
    // 1. Check if members modal is ALREADY open
    const existingModal = findOpenMembersModal();
    if (existingModal) {
      log('Full members modal is already open.');
      return existingModal;
    }

    if (!drawer) return null;

    // 2. Look for "View all" button in drawer
    let viewAllBtn = queryFirst(SELECTORS.viewAllButtons, drawer);

    // Heuristic search for "View all" / "more" text in drawer
    if (!viewAllBtn) {
      const candidates = drawer.querySelectorAll('button, div[role="button"], span, div');
      for (const cand of candidates) {
        const txt = (cand.innerText || cand.textContent || '').toLowerCase().trim();
        if (
          txt.includes('view all') ||
          txt.includes('ver todos') ||
          txt.includes('afficher tout') ||
          txt.includes('alle anzeigen') ||
          /\d+\s+more\b/i.test(txt) ||
          /\d+\s+mais\b/i.test(txt)
        ) {
          viewAllBtn = cand;
          break;
        }
      }
    }

    // Also check for search button (magnifying glass) inside members section
    if (!viewAllBtn) {
      const spans = drawer.querySelectorAll('span, div');
      for (const s of spans) {
        if (/(?:members|participants)/i.test(s.innerText || '')) {
          const parent = s.closest('div[role="region"]') || s.parentElement;
          if (parent) {
            const btn = parent.querySelector('span[data-testid="search"], button, div[role="button"]');
            if (btn) {
              viewAllBtn = btn;
              break;
            }
          }
        }
      }
    }

    if (viewAllBtn) {
      log('Found "View all" members button. Clicking to open full list...');
      viewAllBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300);
      viewAllBtn.click();

      // Wait for modal to render
      const modal = await waitForCondition(() => findOpenMembersModal(), 6000);
      if (modal) {
        log('Full members modal opened successfully.');
        await sleep(500);
        return modal;
      }
    }

    // If no "View all" button (e.g. small group), the participant list is directly in drawer
    log('No "View all" button found or needed. Using group info drawer directly.');
    return drawer;
  }

  /**
   * Resilient participant row finder with fallback heuristics.
   * @param {Element} root 
   * @returns {Element[]}
   */
  function findAllParticipantRows(root = document) {
    if (!root) return [];

    // 1. Primary selectors
    let rows = queryAll(SELECTORS.participantRow, root);

    // Filter out elements that don't match typical row dimensions (height between 35px and 150px)
    rows = rows.filter(r => {
      const rect = r.getBoundingClientRect();
      return rect.height >= 35 && rect.height <= 150;
    });

    if (rows.length > 0) {
      return rows;
    }

    // 2. Heuristic fallback: search for elements with an avatar and text
    const candidates = root.querySelectorAll('div[tabindex="-1"], div[role="button"], div');
    const detected = [];

    for (const c of candidates) {
      const rect = c.getBoundingClientRect();
      if (rect.height >= 40 && rect.height <= 120 && rect.width > 200) {
        const hasAvatar = c.querySelector('img[src*="blob:"], img[src*="whatsapp.net"], [data-testid="default-user"], [data-testid="avatar"]');
        const hasText = c.querySelector('span[title], span[dir="auto"]');

        if (hasAvatar && hasText) {
          let isParent = false;
          for (const existing of detected) {
            if (c.contains(existing)) {
              isParent = true;
              break;
            }
          }
          if (!isParent) {
            detected.push(c);
          }
        }
      }
    }

    return detected;
  }

  /**
   * Finds the actual scrollable participant list container inside modal or drawer.
   * Uses ancestor tree inspection from visible rows to guarantee finding the TRUE scrollable element.
   * @param {Element} parentContainer 
   * @returns {Element|null}
   */
  function findParticipantContainer(parentContainer) {
    const rows = findAllParticipantRows(parentContainer);
    log(`Locating scrollable container for ${rows.length} rows...`);

    if (rows.length > 0) {
      // 1. Walk up the DOM tree from the first row to find the scrollable ancestor
      let el = rows[0].parentElement;
      while (el && el !== document.body && el !== document.documentElement) {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        const hasScrollStyle = (overflowY === 'auto' || overflowY === 'scroll');

        if (hasScrollStyle && el.scrollHeight > el.clientHeight + 10) {
          log(`Found scrollable container via row ancestor: <${el.tagName.toLowerCase()}> with scrollHeight: ${el.scrollHeight}, clientHeight: ${el.clientHeight}`);
          return el;
        }
        el = el.parentElement;
      }

      // 2. Secondary ancestor check for height diff
      el = rows[0].parentElement;
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 100) {
          log(`Found scrollable container via height difference: <${el.tagName.toLowerCase()}> (diff=${el.scrollHeight - el.clientHeight}px)`);
          return el;
        }
        el = el.parentElement;
      }
    }

    // 3. Search all descendants in parentContainer for scrollable elements
    const allDivs = parentContainer.querySelectorAll('div, section, ul');
    let best = null;
    let maxDiff = 0;

    for (const d of allDivs) {
      const diff = d.scrollHeight - d.clientHeight;
      if (diff > maxDiff && d.clientHeight > 100) {
        const style = window.getComputedStyle(d);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          maxDiff = diff;
          best = d;
        }
      }
    }

    if (best) {
      log(`Found scrollable container via descendant query: <${best.tagName.toLowerCase()}> (diff=${maxDiff}px)`);
      return best;
    }

    return parentContainer;
  }

  /**
   * Helper to check if a string appears to be a phone number.
   * @param {string} str 
   * @returns {boolean}
   */
  function isPhoneNumberString(str) {
    if (!str || typeof str !== 'string') return false;
    const clean = str.trim();
    if (/^(?:\+|00)?\s*\d[\d\s\-()]{5,}\d$/.test(clean)) {
      const digits = clean.replace(/\D/g, '');
      return digits.length >= 7;
    }
    return false;
  }

  /**
   * Extracts participant name, phone, and role from a single DOM row element.
   * Returns null if the row is a UI header or non-participant.
   * @param {Element} row 
   * @returns {{ name: string, phone: string, role: string }|null}
   */
  function extractParticipantFromRow(row) {
    if (!row) return null;

    let name = '';
    let phone = 'Not available';
    let role = 'Member';

    // 1. Role: Check for Admin badge
    const adminEl = queryFirst(SELECTORS.adminBadge, row);
    if (adminEl) {
      role = 'Admin';
    } else {
      const rowText = (row.innerText || row.textContent || '');
      if (/\b(?:group admin|community admin|admin do grupo|administrador|creator|owner|admin)\b/i.test(rowText)) {
        role = 'Admin';
      }
    }

    // 2. Extract distinct text values from row
    const spans = row.querySelectorAll('span[title], [data-testid="cell-frame-title"] span, span[dir="auto"], span');
    const texts = [];

    for (const s of spans) {
      const tAttr = (s.getAttribute('title') || '').trim();
      const tInner = (s.innerText || s.textContent || '').trim();
      const candidate = tAttr.length > 0 ? tAttr : tInner;

      if (
        candidate.length > 0 &&
        !texts.includes(candidate) &&
        !/^(?:group admin|community admin|admin|creator)$/i.test(candidate)
      ) {
        texts.push(candidate);
      }
    }

    if (texts.length === 0) {
      return null;
    }

    const primary = texts[0];

    // Filter out UI control elements or single-letter alphabetical headers
    if (
      primary.length <= 1 ||
      /^(?:search contacts|search members|add member|invite to group via link)$/i.test(primary)
    ) {
      return null;
    }

    if (isPhoneNumberString(primary)) {
      phone = WAExporter.cleanPhoneNumber(primary);
      if (texts.length > 1 && !isPhoneNumberString(texts[1])) {
        name = WAExporter.cleanName(texts[1].replace(/^~/, ''));
      } else {
        name = primary;
      }
    } else {
      name = WAExporter.cleanName(primary);
      for (let i = 1; i < texts.length; i++) {
        if (isPhoneNumberString(texts[i])) {
          phone = WAExporter.cleanPhoneNumber(texts[i]);
          break;
        }
      }
      if (phone === 'Not available') {
        const allText = row.innerText || row.textContent || '';
        const phoneMatch = allText.match(/(?:\+|00)\s*\d[\d\s\-()]{6,}\d/);
        if (phoneMatch) {
          phone = WAExporter.cleanPhoneNumber(phoneMatch[0]);
        }
      }
    }

    if (!name || name === 'Unknown') {
      if (phone !== 'Not available') {
        name = phone;
      } else {
        name = primary;
      }
    }

    return {
      name: WAExporter.cleanName(name),
      phone: WAExporter.cleanPhoneNumber(phone),
      role: WAExporter.cleanRole(role)
    };
  }

  /**
   * Broadcasts extraction progress to popup and storage.
   * @param {string} status 
   * @param {string} statusMessage 
   */
  function broadcastProgress(status, statusMessage) {
    const participantsList = Array.from(participantsMap.values());
    const payload = {
      action: 'EXTRACTION_PROGRESS',
      status,
      statusMessage,
      currentGroup,
      totalCount: detectedTotal,
      count: participantsList.length,
      participants: participantsList,
      lastUpdated: Date.now()
    };

    chrome.storage.local.set({
      currentGroup,
      totalCount: detectedTotal,
      participants: participantsList,
      extractionStatus: status,
      statusMessage,
      lastUpdated: Date.now()
    });

    chrome.runtime.sendMessage(payload).catch(() => {});
  }

  /**
   * Main scrolling and participant extraction engine.
   * Handles 1,000+ virtualized participants smoothly.
   */
  async function runExtraction() {
    if (isExtracting) {
      log('Extraction is already in progress.');
      return;
    }

    isExtracting = true;
    extractionCancelled = false;
    participantsMap.clear();

    try {
      broadcastProgress('opening_list', 'Checking open group...');

      // 1. Detect Group
      const { groupName } = detectGroup();
      if (!groupName) {
        throw new Error('Please open a WhatsApp group and try again.');
      }
      currentGroup = groupName;

      // 2. Check if Search members / group modal is ALREADY open
      let listWrapper = findOpenMembersModal();
      let drawer = null;

      if (listWrapper) {
        log('Participant list modal is already open in the DOM.');
        detectedTotal = detectTotalCount(listWrapper) || detectTotalCount(document);
      } else {
        // Open Group Info Panel
        broadcastProgress('opening_list', 'Opening group info...');
        drawer = await openGroupInfoPanel();
        if (extractionCancelled) return handleCancelled();

        // Detect Total Count (if visible in drawer)
        detectedTotal = detectTotalCount(drawer);

        // Open Full Participant List / Modal
        broadcastProgress('scrolling_list', 'Opening full participant list...');
        listWrapper = await openFullMembersList(drawer);
        if (extractionCancelled) return handleCancelled();

        if (!detectedTotal) {
          detectedTotal = detectTotalCount(listWrapper);
        }
      }

      // 3. Locate Scrollable Container
      let container = findParticipantContainer(listWrapper || document);
      if (!container) {
        throw new Error('Could not locate the participant list container. WhatsApp Web may have changed its interface.');
      }

      log(`Scrollable container bound: <${container.tagName.toLowerCase()}> (scrollHeight=${container.scrollHeight}, clientHeight=${container.clientHeight})`);
      broadcastProgress('extracting', 'Scanning participant list...');

      // Virtualized Scrolling Loop Variables
      let noNewDataCounter = 0;
      let scrollIterations = 0;
      let consecutiveStuckScrolls = 0;

      while (!extractionCancelled) {
        scrollIterations++;

        // A. Find all visible rows
        let visibleRows = findAllParticipantRows(container);

        if (visibleRows.length === 0 && listWrapper) {
          visibleRows = findAllParticipantRows(listWrapper);
        }

        let newlyAddedThisStep = 0;

        for (const row of visibleRows) {
          const participant = extractParticipantFromRow(row);
          if (!participant) continue;

          let key = (participant.phone !== 'Not available')
            ? `phone:${participant.phone}`
            : `name:${participant.name.toLowerCase()}|${participant.role}`;

          if (!participantsMap.has(key)) {
            participantsMap.set(key, participant);
            newlyAddedThisStep++;
          } else {
            const existing = participantsMap.get(key);
            if (existing.phone === 'Not available' && participant.phone !== 'Not available') {
              existing.phone = participant.phone;
            }
          }
        }

        log(`Iteration ${scrollIterations}: ${visibleRows.length} visible rows, ${newlyAddedThisStep} new participants. Total: ${participantsMap.size}`);

        // Update progress
        if (newlyAddedThisStep > 0) {
          noNewDataCounter = 0;
          consecutiveStuckScrolls = 0;
          const totalStr = detectedTotal ? ` / ${detectedTotal}` : '';
          broadcastProgress('extracting', `Extracting participants (${participantsMap.size}${totalStr} found)...`);
        } else {
          noNewDataCounter++;
        }

        // B. Check completion
        const hasTotal = Boolean(detectedTotal && detectedTotal > 0);
        if (hasTotal && participantsMap.size >= detectedTotal) {
          log(`Successfully extracted all ${detectedTotal} participants!`);
          break;
        }

        const isActuallyAtBottom = (container.scrollTop > 50) && 
                                   (container.scrollTop + container.clientHeight >= container.scrollHeight - 25);

        const maxAttempts = hasTotal ? 12 : 6;

        if (noNewDataCounter >= maxAttempts) {
          log(`No new participants found after ${noNewDataCounter} attempts. Checking completion...`);

          if (isActuallyAtBottom || (hasTotal && participantsMap.size >= detectedTotal * 0.95)) {
            // Final verification shake
            log('Performing final verification shake...');
            container.scrollTop = Math.max(0, container.scrollTop - 200);
            container.dispatchEvent(new Event('scroll', { bubbles: true }));
            await sleep(350);

            container.scrollTop = container.scrollHeight;
            container.dispatchEvent(new Event('scroll', { bubbles: true }));
            if (visibleRows.length > 0) {
              try {
                visibleRows[visibleRows.length - 1].scrollIntoView({ block: 'end', behavior: 'instant' });
              } catch (e) {}
            }
            await sleep(500);

            const checkRows = findAllParticipantRows(container);
            let checkAdded = 0;
            for (const r of checkRows) {
              const p = extractParticipantFromRow(r);
              if (!p) continue;
              const k = (p.phone !== 'Not available') ? `phone:${p.phone}` : `name:${p.name.toLowerCase()}|${p.role}`;
              if (!participantsMap.has(k)) {
                participantsMap.set(k, p);
                checkAdded++;
              }
            }

            if (checkAdded === 0) {
              log(`Final verification complete. Total collected: ${participantsMap.size}`);
              break;
            } else {
              noNewDataCounter = 0;
            }
          }
        }

        if (extractionCancelled) return handleCancelled();

        // C. Multi-action Scroll Down
        const prevScrollTop = container.scrollTop;
        const scrollStep = Math.max(300, Math.floor(container.clientHeight * 0.75 || 400));

        // 1. Direct scrollTop
        container.scrollTop += scrollStep;

        // 2. scrollBy
        if (typeof container.scrollBy === 'function') {
          container.scrollBy({ top: scrollStep, behavior: 'instant' });
        }

        // 3. Native scrollIntoView on last visible row (forces virtual list rendering)
        if (visibleRows.length > 0) {
          const lastRow = visibleRows[visibleRows.length - 1];
          try {
            lastRow.scrollIntoView({ block: 'end', behavior: 'instant' });
          } catch (e) {}
        }

        // 4. Dispatch synthetic events
        container.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: true }));
        container.dispatchEvent(new WheelEvent('wheel', {
          deltaY: scrollStep,
          deltaMode: 0,
          bubbles: true,
          cancelable: true
        }));

        // Stuck detection
        if (container.scrollTop === prevScrollTop && !isActuallyAtBottom) {
          consecutiveStuckScrolls++;
          log(`Container scrollTop did not change (${container.scrollTop}). Stuck count: ${consecutiveStuckScrolls}`);

          if (consecutiveStuckScrolls >= 2) {
            log('Attempting to re-find active scroll container...');
            const fresh = findParticipantContainer(listWrapper || document);
            if (fresh && fresh !== container) {
              log('Switched to new scrollable container!');
              container = fresh;
              consecutiveStuckScrolls = 0;
            }
          }
        } else {
          consecutiveStuckScrolls = 0;
        }

        // D. Delay for lazy load
        await sleep(280);
      }

      if (extractionCancelled) {
        return handleCancelled();
      }

      if (participantsMap.size === 0) {
        throw new Error('No participants were detected. Please verify that the group participant list is visible.');
      }

      log(`Extraction complete! Total unique participants: ${participantsMap.size}`);
      broadcastProgress('completed', `Extraction complete. ${participantsMap.size} participants collected.`);

    } catch (err) {
      errorLog('Extraction error:', err);
      broadcastProgress('error', err.message || 'An error occurred during extraction.');
    } finally {
      isExtracting = false;
    }
  }

  function handleCancelled() {
    log(`Extraction stopped by user. ${participantsMap.size} participants collected.`);
    broadcastProgress('stopped', `Extraction stopped. ${participantsMap.size} participants collected.`);
    isExtracting = false;
  }

  /**
   * Listen for messages from popup or background.
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log('Received message:', request.action);

    if (request.action === 'DETECT_GROUP') {
      const res = detectGroup();
      if (res.groupName) {
        const total = detectTotalCount();
        sendResponse({ success: true, groupName: res.groupName, isGroup: res.isGroup, totalCount: total });
      } else {
        sendResponse({ success: false, error: 'Open a WhatsApp group first.' });
      }
      return true;
    }

    if (request.action === 'START_EXTRACTION') {
      if (!isExtracting) {
        runExtraction();
        sendResponse({ success: true, status: 'started' });
      } else {
        sendResponse({ success: false, error: 'Extraction is already running.' });
      }
      return true;
    }

    if (request.action === 'STOP_EXTRACTION') {
      extractionCancelled = true;
      sendResponse({ success: true, status: 'stopping' });
      return true;
    }

    if (request.action === 'GET_STATE') {
      sendResponse({
        isExtracting,
        currentGroup,
        totalCount: detectedTotal,
        count: participantsMap.size,
        participants: Array.from(participantsMap.values())
      });
      return true;
    }

    if (request.action === 'CLEAR_DATA') {
      participantsMap.clear();
      detectedTotal = null;
      chrome.storage.local.set({
        currentGroup: null,
        totalCount: null,
        participants: [],
        extractionStatus: 'ready',
        statusMessage: 'Ready to extract',
        lastUpdated: Date.now()
      });
      sendResponse({ success: true });
      return true;
    }

    return false;
  });

  log('WA Group Member Exporter content script initialized.');
})();
