// contact.html のブラウザテスト（Playwright）
// 実行：node --test tests/
// 画面写真は tests/screenshots/ に保存されます。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SITE_PORT = 8790;
const GAS_PORT = 8791;
const SITE = `http://localhost:${SITE_PORT}/contact.html`;
const GAS = `http://localhost:${GAS_PORT}/exec`;

// --- 次の「平日（木曜以外）」「土曜」「木曜」を求める ---
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function nextDay(pred) {
  const d = new Date();
  do { d.setDate(d.getDate() + 1); } while (!pred(d.getDay()));
  return ymd(d);
}
const OPEN_DAY = nextDay((w) => [1, 2, 3, 5].includes(w));
const SATURDAY = nextDay((w) => w === 6);
const THURSDAY = nextDay((w) => w === 4);

let site, gas, browser;

test.before(async () => {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
  site = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  }).listen(SITE_PORT);

  gas = spawn(process.execPath, [path.join(__dirname, 'mock-gas-server.js'), String(GAS_PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => gas.stdout.once('data', r));
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  site?.close();
  gas?.kill();
});

// GAS_URL を書き換えた contact.js を渡す（ファイル自体は変更しない）
async function openPage({ gasUrl = '', viewport = { width: 1280, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (gasUrl) {
    await page.route('**/contact.js', async (route) => {
      const js = fs.readFileSync(path.join(ROOT, 'contact.js'), 'utf8').replace("const GAS_URL = '';", `const GAS_URL = '${gasUrl}';`);
      await route.fulfill({ contentType: 'text/javascript', body: js });
    });
  }
  await page.goto(SITE);
  page.jsErrors = errors;
  return page;
}

async function fillValid(page, over = {}) {
  const v = {
    name: '佐藤 花子', kana: 'さとう はなこ', tel: '090-1234-5678', email: 'hanako@example.com',
    type: '予防接種', date1: OPEN_DAY, time1: '午前', message: 'テスト送信です。', ...over,
  };
  await page.fill('#name', v.name);
  await page.fill('#kana', v.kana);
  await page.fill('#tel', v.tel);
  await page.fill('#email', v.email);
  await page.selectOption('#type', v.type);
  await page.fill('#date1', v.date1);
  await page.selectOption('#time1', v.time1);
  await page.fill('#message', v.message);
  await page.check('#agree');
}

test('画面写真（PC・スマホ）とレイアウト崩れの確認', async () => {
  const pc = await openPage();
  await pc.screenshot({ path: path.join(SHOTS, 'pc.png'), fullPage: true });
  const sp = await openPage({ viewport: { width: 390, height: 844 } });
  await sp.screenshot({ path: path.join(SHOTS, 'sp.png'), fullPage: true });
  // 横スクロールが出ていない
  const overflow = await sp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `スマホで横にはみ出しています（${overflow}px）`);
  // ロゴが読み込めている
  assert.ok(await pc.evaluate(() => document.querySelector('.brand img').naturalWidth > 0));
  assert.deepEqual(pc.jsErrors, []);
  await pc.close(); await sp.close();
});

test('空のまま送信：エラー一覧と各欄のエラーが出る', async () => {
  const page = await openPage();
  await page.click('#submit-btn');
  const summary = page.locator('#error-summary');
  await summary.waitFor({ state: 'visible' });
  assert.equal(await summary.locator('li').count(), 6); // 名前・ふりがな・電話・内容・第1希望・同意（初診は初期選択済み）
  assert.equal(await page.getAttribute('#name', 'aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'error-summary');
  await page.screenshot({ path: path.join(SHOTS, 'errors.png'), fullPage: true });
  // 一覧のリンクで、その欄に移動する
  await summary.locator('a').first().click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'name');
  // 直したらすぐエラーが消える
  await page.fill('#name', '佐藤 花子');
  assert.equal(await page.textContent('#name-error'), '');
  await page.close();
});

test('入力の整え：カタカナ→ひらがな、全角の電話番号→半角', async () => {
  const page = await openPage();
  await page.fill('#kana', 'サトウ ハナコ');
  await page.fill('#tel', '０９０ー１２３４ー５６７８');
  await page.click('#name');
  assert.equal(await page.inputValue('#kana'), 'さとう はなこ');
  assert.equal(await page.inputValue('#tel'), '090-1234-5678');
  await page.close();
});

test('希望日：木曜はエラー、土曜は午後を選べない', async () => {
  const page = await openPage();
  await page.fill('#date1', THURSDAY);
  await page.dispatchEvent('#date1', 'change');
  assert.match(await page.textContent('#date1-error'), /木曜日は休診日/);
  await page.fill('#date1', SATURDAY);
  await page.dispatchEvent('#date1', 'change');
  assert.equal(await page.locator('#time1 option[value="午後"]').isDisabled(), true);
  assert.equal(await page.textContent('#date1-error'), '');
  // 明日より前は選べないよう min が付いている
  assert.ok((await page.getAttribute('#date1', 'min')) > ymd(new Date()));
  await page.close();
});

test('Google未接続（GAS_URLが空）：テスト表示で完了画面が出る', async () => {
  const page = await openPage();
  await fillValid(page);
  await page.click('#submit-btn');
  await page.locator('#complete').waitFor({ state: 'visible' });
  assert.equal(await page.textContent('#receipt-id'), 'TEST-000000');
  assert.equal(await page.locator('#demo-note').isVisible(), true);
  assert.equal(await page.locator('#reserve-form').isVisible(), false);
  await page.close();
});

test('Apps Scriptへ送信：受付番号が出て、医院への通知と自動返信が送られる', async () => {
  const page = await openPage({ gasUrl: GAS });
  await fillValid(page, { kana: 'サトウ ハナコ' });
  await page.fill('#date2', SATURDAY);
  await page.dispatchEvent('#date2', 'change');
  await page.selectOption('#time2', '午前');
  await page.click('#submit-btn');
  await page.locator('#complete').waitFor({ state: 'visible' });
  assert.match(await page.textContent('#receipt-id'), /^SATO-\d{6}-0001$/);
  assert.equal(await page.locator('#demo-note').isVisible(), false);
  await page.screenshot({ path: path.join(SHOTS, 'complete.png'), fullPage: true });

  const { sent, rows } = await (await fetch(`http://localhost:${GAS_PORT}/sent`)).json();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'kazuhide.aoki@gmail.com');
  assert.equal(sent[0].opt.replyTo, 'hanako@example.com');
  assert.equal(sent[1].to, 'hanako@example.com');
  assert.equal(rows[1][3], 'さとう はなこ');
  assert.equal(rows[1][10], SATURDAY);
  assert.deepEqual(page.jsErrors, []);
  await page.close();
});

test('サーバー側でエラー：その欄にエラーを表示', async () => {
  const page = await openPage({ gasUrl: GAS });
  await fillValid(page);
  // 画面のチェックをすり抜けた想定で、送信直前に値を書き換える
  await page.evaluate(() => { const o = document.querySelector('#type option:last-child'); o.value = '整形外科'; o.selected = true; });
  await page.click('#submit-btn');
  await page.locator('#error-summary').waitFor({ state: 'visible' });
  assert.match(await page.textContent('#type-error'), /ご希望の内容を選択/);
  await page.close();
});

test('通信できない：電話番号つきのお詫びを表示し、もう一度送れる', async () => {
  const page = await openPage({ gasUrl: 'http://localhost:1/exec' });
  await fillValid(page);
  await page.click('#submit-btn');
  await page.locator('#error-summary').waitFor({ state: 'visible' });
  assert.match(await page.textContent('#error-summary'), /送信できませんでした[\s\S]*00-0000-0000/);
  assert.equal(await page.isEnabled('#submit-btn'), true);
  assert.equal(await page.textContent('#submit-btn'), '送信する');
  await page.close();
});

test('スマホ：メニューの開閉', async () => {
  const page = await openPage({ viewport: { width: 390, height: 844 } });
  assert.equal(await page.locator('#global-nav').isVisible(), false);
  await page.click('.menu-toggle');
  assert.equal(await page.locator('#global-nav').isVisible(), true);
  assert.equal(await page.getAttribute('.menu-toggle', 'aria-expanded'), 'true');
  await page.screenshot({ path: path.join(SHOTS, 'sp-menu.png') });
  await page.close();
});
