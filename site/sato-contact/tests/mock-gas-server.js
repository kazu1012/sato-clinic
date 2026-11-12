// Code.gs を手元で動かす「Apps Scriptの代わり」のサーバー（テスト用）
// 使い方：node tests/mock-gas-server.js 8787
//   POST /exec  … doPost に渡し、結果のJSONを返す
//   GET  /sent  … 送られたはずのメールとシートの行を確認できる
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const port = Number(process.argv[2] || 8787);
const CODE = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

const sent = [];
const rows = [];
const props = {};
const cache = {};
const sheet = {
  getLastRow: () => rows.length, appendRow: (r) => rows.push(r), setFrozenRows() {}, setName() {},
  getRange: () => ({ setFontWeight() { return this; }, setBackground() { return this; } }),
  getParent: () => ss,
};
const ss = { getId: () => 'SS1', getUrl: () => 'https://docs.google.com/spreadsheets/d/SS1', getSheetByName: () => (rows.length ? sheet : null), getSheets: () => [sheet] };

const ctx = {
  console,
  MailApp: { sendEmail: (to, subject, body, opt) => sent.push({ to, subject, body, opt: opt || {} }) },
  SpreadsheetApp: { create: () => ss, openById: () => ss },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const j = new Date(d.getTime() + 9 * 3600e3);
      const p = (n) => String(n).padStart(2, '0');
      return fmt.replace('yyyy', j.getUTCFullYear()).replace('yy', String(j.getUTCFullYear()).slice(2))
        .replace('MM', p(j.getUTCMonth() + 1)).replace('dd', p(j.getUTCDate()))
        .replace('HH', p(j.getUTCHours())).replace('mm', p(j.getUTCMinutes())).replace('ss', p(j.getUTCSeconds()));
    },
    base64EncodeWebSafe: (s) => Buffer.from(s).toString('base64url'),
  },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }) },
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);

http.createServer((req, res) => {
  // 本物のApps Scriptと同じく、どのサイトからでも結果を読めるようにする
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'POST' && req.url.startsWith('/exec')) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.headers['content-type'] && !/^(text\/plain|application\/x-www-form-urlencoded|multipart\/form-data)/.test(req.headers['content-type'])) {
        res.writeHead(415); res.end('not a simple request'); return;
      }
      const parameter = Object.fromEntries(new URLSearchParams(raw));
      const out = ctx.doPost({ parameter }).getContent();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(out);
    });
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/sent')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ sent, rows }));
    return;
  }
  if (req.method === 'OPTIONS') { res.writeHead(405); res.end(); return; } // 本物も事前確認(preflight)には応じない
  res.writeHead(404); res.end();
}).listen(port, () => console.log(`mock GAS on http://localhost:${port}/exec`));
