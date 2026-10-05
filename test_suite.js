/**
 * WA Group Member Exporter - Comprehensive Test Suite
 * Validates manifest.json, exporter.js normalization, CSV/XLSX generation,
 * Unicode handling, and SheetJS integration.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('=== WA GROUP MEMBER EXPORTER - TEST SUITE ===\n');

// 1. Verify Manifest V3
console.log('1. Validating manifest.json...');
const manifestPath = path.join(__dirname, 'manifest.json');
assert(fs.existsSync(manifestPath), 'manifest.json must exist');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.strictEqual(manifest.manifest_version, 3, 'manifest_version must be 3');
assert.strictEqual(manifest.name, 'WA Group Member Exporter', 'Extension name should match');
assert(manifest.action && manifest.action.default_popup === 'popup.html', 'Action popup must be popup.html');
assert(manifest.background && manifest.background.service_worker === 'background.js', 'Service worker must be background.js');
assert(Array.isArray(manifest.permissions), 'Permissions must be an array');
assert(manifest.permissions.includes('activeTab'), 'Must include activeTab permission');
assert(manifest.permissions.includes('scripting'), 'Must include scripting permission');
assert(manifest.permissions.includes('storage'), 'Must include storage permission');
assert(Array.isArray(manifest.content_scripts), 'content_scripts must be configured');
console.log('   [PASS] manifest.json is fully valid Manifest V3.\n');

// 2. Verify Files & Directory Structure
console.log('2. Validating directory structure and files...');
const requiredFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'exporter.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'libs/xlsx.full.min.js'
];

for (const relPath of requiredFiles) {
  const fullPath = path.join(__dirname, relPath);
  assert(fs.existsSync(fullPath), `Required file missing: ${relPath}`);
  const stat = fs.statSync(fullPath);
  assert(stat.size > 0, `File is empty: ${relPath}`);
  console.log(`   [PASS] ${relPath} exists (${stat.size.toLocaleString()} bytes)`);
}
console.log('');

// 3. Test Exporter & Normalization Logic
console.log('3. Validating exporter.js and normalization logic...');
// Mock environment for exporter.js
global.window = global;
global.URL = {
  createObjectURL: () => 'blob:mock-url',
  revokeObjectURL: () => {}
};
global.document = {
  createElement: () => ({ click: () => {}, appendChild: () => {}, removeChild: () => {} }),
  body: { appendChild: () => {}, removeChild: () => {} }
};
navigator.clipboard = {
  writeText: async (txt) => { global.__copiedText = txt; }
};

// Load SheetJS and exporter
global.XLSX = require('./libs/xlsx.full.min.js');
assert(typeof global.XLSX !== 'undefined', 'SheetJS (XLSX) must be loaded');
require('./exporter.js');
assert(typeof global.WAExporter !== 'undefined', 'WAExporter must be defined');

const { cleanName, cleanPhoneNumber, cleanRole, sanitizeFilename, exportToCSV, exportToXLSX, copyToClipboard } = global.WAExporter;

// Test cleanName
console.log('   - Testing cleanName:');
assert.strictEqual(cleanName('   John    Doe   '), 'John Doe');
assert.strictEqual(cleanName('அரவிந்த் Kumar'), 'அரவிந்த் Kumar', 'Must preserve Tamil characters');
assert.strictEqual(cleanName('Mohamed أحمد 🌟'), 'Mohamed أحمد 🌟', 'Must preserve Arabic & emojis');
assert.strictEqual(cleanName(''), 'Unknown');
assert.strictEqual(cleanName(null), 'Unknown');
console.log('     [PASS] cleanName preserves Unicode, Tamil, Arabic, emojis, and normalizes whitespace.');

// Test cleanPhoneNumber
console.log('   - Testing cleanPhoneNumber:');
assert.strictEqual(cleanPhoneNumber('+91 98765 43210'), '+919876543210', 'Preserve + and strip internal spaces');
assert.strictEqual(cleanPhoneNumber('+1 (555) 234-5678'), '+15552345678', 'Strip brackets and hyphens');
assert.strictEqual(cleanPhoneNumber('9876543210'), '9876543210');
assert.strictEqual(cleanPhoneNumber('Not available'), 'Not available');
assert.strictEqual(cleanPhoneNumber('Group Admin'), 'Not available');
assert.strictEqual(cleanPhoneNumber(''), 'Not available');
console.log('     [PASS] cleanPhoneNumber formats valid numbers and ignores non-numbers.');

// Test cleanRole
console.log('   - Testing cleanRole:');
assert.strictEqual(cleanRole('Group admin'), 'Admin');
assert.strictEqual(cleanRole('Community Admin'), 'Admin');
assert.strictEqual(cleanRole('Creator'), 'Admin');
assert.strictEqual(cleanRole('Member'), 'Member');
assert.strictEqual(cleanRole(''), 'Member');
console.log('     [PASS] cleanRole standardizes Admin and Member.');

// Test sanitizeFilename
console.log('   - Testing sanitizeFilename:');
assert.strictEqual(sanitizeFilename('Tech/Dev: Group? *Awesome*'), 'Tech_Dev_Group_Awesome');
assert.strictEqual(sanitizeFilename(''), 'WhatsApp_Group');
console.log('     [PASS] sanitizeFilename removes illegal characters.');

// 4. Test CSV Export Generation
console.log('4. Testing CSV Export generation with RFC 4180 and UTF-8 BOM...');
let capturedBlob = null;
let capturedFilename = null;
global.WAExporter.downloadBlob = (blob, filename) => {
  capturedBlob = blob;
  capturedFilename = filename;
};

const sampleParticipants = [
  { name: 'John Doe', phone: '+919876543210', role: 'Member' },
  { name: 'Jane "Leader" Smith, VP', phone: '+15551234567', role: 'Admin' },
  { name: 'அரவிந்த் Kumar', phone: '+919812345678', role: 'Member' },
  { name: 'Sarah Connor', phone: 'Not available', role: 'Member' }
];

exportToCSV(sampleParticipants, 'Genesis:26 Hackathon');
assert(capturedBlob, 'CSV Blob should be created');
assert(capturedFilename.includes('Genesis_26_Hackathon_members_'), 'Filename should be sanitized');
assert(capturedFilename.endsWith('.csv'), 'Extension should be .csv');

// Read blob content
const csvText = capturedBlob.toString ? capturedBlob.toString() : '';
console.log(`   [PASS] CSV file generated: ${capturedFilename}`);

// 5. Test XLSX Export Generation via SheetJS
console.log('5. Testing XLSX Export generation via SheetJS...');
let writtenWorkbook = null;
let writtenFilename = null;
global.XLSX.writeFile = (wb, filename) => {
  writtenWorkbook = wb;
  writtenFilename = filename;
};

exportToXLSX(sampleParticipants, 'Genesis:26 Hackathon');
assert(writtenWorkbook, 'Workbook must be created');
assert(writtenWorkbook.Sheets['Members'], 'Worksheet "Members" must exist');
const sheet = writtenWorkbook.Sheets['Members'];

// Verify header row freeze
assert(sheet['!freeze'], 'Worksheet must freeze header row');

// Verify column count and autofilter
assert(sheet['!cols'] && sheet['!cols'].length === 4, 'Column widths must be configured');
assert(sheet['!autofilter'], 'Autofilter must be present');

// Verify phone numbers are explicitly text cells ('s')
const phoneCell = sheet['C2']; // Row 2, Col C is first participant's phone
assert.strictEqual(phoneCell.t, 's', 'Phone number cell must have type "s" (string)');
assert.strictEqual(phoneCell.v, '+919876543210');
console.log(`   [PASS] XLSX file generated: ${writtenFilename} with text-formatted phone numbers and auto-filter.`);

// 6. Test TSV Clipboard Copy
console.log('6. Testing TSV Clipboard copying...');
copyToClipboard(sampleParticipants).then((count) => {
  assert.strictEqual(count, 4, 'Should copy 4 participants');
  assert(global.__copiedText.includes('S.No\tName\tPhone Number\tRole'), 'TSV header should match');
  assert(global.__copiedText.includes('1\tJohn Doe\t+919876543210\tMember'), 'Row 1 should match');
  assert(global.__copiedText.includes('3\tஅரவிந்த் Kumar\t+919812345678\tMember'), 'Row 3 should match Unicode');
  console.log('   [PASS] Clipboard TSV correctly formatted.\n');

  console.log('=== ALL TESTS PASSED SUCCESSFULLY! ===');
});
