/**
 * WA Group Member Exporter - Exporter Utility Library
 * Handles data normalization, CSV generation, XLSX generation via SheetJS, and clipboard TSV formatting.
 */

(function (global) {
  'use strict';

  const WAExporter = {};

  /**
   * Normalizes whitespace while preserving all Unicode characters, regional scripts, emojis, and punctuation.
   * @param {string} rawName 
   * @returns {string}
   */
  WAExporter.cleanName = function (rawName) {
    if (!rawName || typeof rawName !== 'string') return 'Unknown';
    const cleaned = rawName.replace(/\s+/g, ' ').trim();
    return cleaned.length > 0 ? cleaned : 'Unknown';
  };

  /**
   * Normalizes phone numbers:
   * - Preserves leading '+' and international country codes
   * - Removes interior spaces, hyphens, and brackets
   * - Preserves leading zeros
   * - Does NOT fabricate missing numbers or guess country codes
   * @param {string} rawPhone 
   * @returns {string}
   */
  WAExporter.cleanPhoneNumber = function (rawPhone) {
    if (!rawPhone || typeof rawPhone !== 'string') return 'Not available';

    const trimmed = rawPhone.trim();
    // Check if it appears to be a phone number (contains digits, optional + prefix)
    const digitMatch = trimmed.match(/\d/g);
    if (!digitMatch || digitMatch.length < 5) {
      return 'Not available';
    }

    const hasPlus = trimmed.startsWith('+');
    // Remove all characters except digits
    const digitsOnly = trimmed.replace(/\D/g, '');

    if (!digitsOnly) return 'Not available';

    return (hasPlus ? '+' : '') + digitsOnly;
  };

  /**
   * Standardizes the role of a participant.
   * @param {string} rawRole 
   * @returns {'Admin' | 'Member' | 'Unknown'}
   */
  WAExporter.cleanRole = function (rawRole) {
    if (!rawRole || typeof rawRole !== 'string') return 'Member';
    const lower = rawRole.toLowerCase();
    if (lower.includes('admin') || lower.includes('creator') || lower.includes('owner')) {
      return 'Admin';
    }
    return 'Member';
  };

  /**
   * Sanitizes a string for use as a file name across Windows, macOS, and Linux.
   * @param {string} name 
   * @returns {string}
   */
  WAExporter.sanitizeFilename = function (name) {
    if (!name || typeof name !== 'string') name = 'WhatsApp_Group';
    // Remove illegal filename characters: \ / : * ? " < > |
    let sanitized = name.replace(/[\\/:*?"<>|]/g, '_').trim();
    // Replace multiple spaces/underscores
    sanitized = sanitized.replace(/[\s_]+/g, '_');
    // Trim leading and trailing underscores
    sanitized = sanitized.replace(/^_+|_+$/g, '');
    return sanitized.length > 0 ? sanitized : 'WhatsApp_Group';
  };

  /**
   * Formats a date object into YYYY-MM-DD.
   * @param {Date} [d] 
   * @returns {string}
   */
  WAExporter.formatDate = function (d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  /**
   * Triggers a browser file download using a Blob.
   * @param {Blob} blob 
   * @param {string} filename 
   */
  WAExporter.downloadBlob = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  };

  /**
   * Exports participants to a UTF-8 BOM CSV file.
   * Ensures Excel opens Unicode, Tamil, Arabic, Hindi, and emoji characters correctly.
   * @param {Array<{name: string, phone: string, role: string}>} participants 
   * @param {string} groupName 
   */
  WAExporter.exportToCSV = function (participants, groupName) {
    if (!participants || participants.length === 0) {
      throw new Error('No participants to export.');
    }

    const headers = ['S.No', 'Name', 'Phone Number', 'Role'];
    const rows = [headers];

    participants.forEach((p, idx) => {
      rows.push([
        String(idx + 1),
        p.name || 'Unknown',
        p.phone || 'Not available',
        p.role || 'Member'
      ]);
    });

    // RFC 4180 CSV line formatter
    const csvContent = rows.map(row => {
      return row.map(cell => {
        const str = String(cell ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',');
    }).join('\r\n');

    // Prepend UTF-8 Byte Order Mark (BOM) \uFEFF for Excel compatibility
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const safeName = WAExporter.sanitizeFilename(groupName);
    const filename = `${safeName}_members_${WAExporter.formatDate()}.csv`;

    WAExporter.downloadBlob(blob, filename);
    return filename;
  };

  /**
   * Exports participants to XLSX format using SheetJS.
   * Configures frozen header row, column widths, autofilters, and text cell formatting for phone numbers.
   * @param {Array<{name: string, phone: string, role: string}>} participants 
   * @param {string} groupName 
   */
  WAExporter.exportToXLSX = function (participants, groupName) {
    if (!participants || participants.length === 0) {
      throw new Error('No participants to export.');
    }

    if (typeof XLSX === 'undefined') {
      throw new Error('SheetJS (XLSX) library is not loaded.');
    }

    // Build array-of-arrays
    const data = [
      ['S.No', 'Name', 'Phone Number', 'Role']
    ];

    participants.forEach((p, idx) => {
      data.push([
        idx + 1,
        p.name || 'Unknown',
        p.phone || 'Not available',
        p.role || 'Member'
      ]);
    });

    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // CRITICAL: Ensure Phone Number column (Col index 2 / 'C') is treated strictly as text ('s')
    // to prevent Excel from removing '+' prefixes or converting numbers to scientific notation.
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    for (let R = 1; R <= range.e.r; ++R) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: 2 });
      if (worksheet[cellAddress]) {
        worksheet[cellAddress].t = 's'; // Force string type
      }
    }

    // Set professional column widths
    worksheet['!cols'] = [
      { wch: 8 },  // S.No
      { wch: 32 }, // Name
      { wch: 24 }, // Phone Number
      { wch: 16 }  // Role
    ];

    // Enable Excel auto-filter
    worksheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: range.e.r, c: range.e.c }
      })
    };

    // Freeze the header row
    worksheet['!freeze'] = {
      xSplit: 0,
      ySplit: 1,
      topLeftCell: 'A2',
      activePane: 'bottomLeft',
      state: 'frozen'
    };

    // Create workbook and append sheet
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Members');

    // Generate binary buffer and download
    const safeName = WAExporter.sanitizeFilename(groupName);
    const filename = `${safeName}_members_${WAExporter.formatDate()}.xlsx`;

    XLSX.writeFile(workbook, filename, { bookType: 'xlsx', type: 'binary' });
    return filename;
  };

  /**
   * Copies participant data to the clipboard as Tab-Separated Values (TSV).
   * Perfect for pasting directly into Google Sheets, Excel, or LibreOffice Calc.
   * @param {Array<{name: string, phone: string, role: string}>} participants 
   * @returns {Promise<number>} Number of participants copied
   */
  WAExporter.copyToClipboard = async function (participants) {
    if (!participants || participants.length === 0) {
      throw new Error('No participants to copy.');
    }

    const headers = ['S.No', 'Name', 'Phone Number', 'Role'];
    const rows = [headers.join('\t')];

    participants.forEach((p, idx) => {
      rows.push([
        idx + 1,
        p.name || 'Unknown',
        p.phone || 'Not available',
        p.role || 'Member'
      ].join('\t'));
    });

    const tsvContent = rows.join('\r\n');
    await navigator.clipboard.writeText(tsvContent);
    return participants.length;
  };

  // Export to global scope
  global.WAExporter = WAExporter;

})(typeof window !== 'undefined' ? window : this);
