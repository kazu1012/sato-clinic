// Google Apps Script の最小限のまね（テスト用）
'use strict';
const vm = require('vm');
const fs = require('fs');

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
function formatDate(d, tz, fmt) {
  const t = new Date(d.getTime() + 9 * 3600 * 1000); // Asia/Tokyo
  return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (k) => ({
    yyyy: t.getUTCFullYear(), yy: pad(t.getUTCFullYear() % 100), MM: pad(t.getUTCMonth() + 1), dd: pad(t.getUTCDate()),
    HH: pad(t.getUTCHours()), mm: pad(t.getUTCMinutes()), ss: pad(t.getUTCSeconds()),
  })[k]);
}

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.rows[this.r - 1 + i] || [];
      out.push(Array.from({ length: this.nc }, (_, j) => (row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j])));
    }
    return out;
  }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this.sheet.set(this.r + i, this.c + j, x))); return this; }
  setValue(x) { this.sheet.set(this.r, this.c, x); return this; }
  setFontWeight() { return this; } setBackground() { return this; } setNumberFormat() { return this; }
}

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.rows = []; }
  set(r, c, x) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    // 文字の先頭の「'」はスプレッドシートでは表示されない
    row[c - 1] = typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x;
  }
  getName() { return this.name; } setName(n) { this.name = n; return this; }
  getLastRow() { let n = this.rows.length; while (n && !this.rows[n - 1].some((v) => v !== '' && v !== undefined)) n--; return n; }
  getLastColumn() { return Math.max(0, ...this.rows.map((r) => r.length)); }
  getMaxRows() { return 1000; }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  appendRow(v) { const r = this.getLastRow() + 1; v.forEach((x, j) => this.set(r, j + 1, x)); return this; }
  setFrozenRows() { return this; }
  getParent() { return this.ss; }
}

class Spreadsheet {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = [new Sheet(this, 'シート1')]; }
  getId() { return this.id; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getSheets() { return this.sheets; }
  insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; }
}

function createWorld() {
  const world = { spreadsheets: {}, mails: [], props: {} };
  world.makeContext = function (file) {
    const cache = {};
    const ctx = {
      console: { log() {}, error: (...a) => world.errors && world.errors.push(a.join(' ')) },
      SpreadsheetApp: {
        openById: (id) => { if (!world.spreadsheets[id]) throw new Error('not found ' + id); return world.spreadsheets[id]; },
        create: (name) => { const id = 'SS' + Object.keys(world.spreadsheets).length; return (world.spreadsheets[id] = new Spreadsheet(id, name)); },
      },
      PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => world.props[file + k] || null, setProperty: (k, v) => { world.props[file + k] = v; } }) },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
      Utilities: { formatDate, base64EncodeWebSafe: (s) => Buffer.from(s).toString('base64url') },
      MailApp: { sendEmail: (...a) => world.mails.push(a) },
      ContentService: {
        MimeType: { JSON: 'json' },
        createTextOutput: (t) => ({ content: t, getContent() { return this.content; }, setMimeType() { return this; } }),
      },
      HtmlService: {},
      Date, Math, JSON, String, Number, Object, Array, Error, Buffer,
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
    return ctx;
  };
  return world;
}

module.exports = { createWorld, Spreadsheet };
