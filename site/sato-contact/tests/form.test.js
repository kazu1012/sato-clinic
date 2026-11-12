// ご予約・ご相談フォームのブラウザテスト（Playwright）
// 対象：サイトの reservation.html（js/reservation.js）と reservation-complete.html（js/reservation-complete.js）
// 実行：npm test（sato-contact フォルダで）
// 画面写真は tests/screenshots/ に保存されます。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const SITE_ROOT = path.join(__dirname, '..', '..'); // site フォルダ
const FORM_JS = path.join(SITE_ROOT, 'js', 'reservation.js');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SITE_PORT = 8790;
const GAS_PORT = 8791;
const SITE = `http://localhost:${SITE_PORT}`;
const FORM_PAGE = `${SITE}/reservation.html`;
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
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  site = http.createServer((req, res) => {
    // 本物の静的サイトと同じく、POST などは受け付けない（JavaScript が送信を引き受けていることの確認になる）
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const file = path.join(SITE_ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(SITE_ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
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

// GAS_URL を書き換えた reservation.js を渡す（ファイル自体は変更しない）
async function openPage({ gasUrl = '', viewport = { width: 1280, height: 900 }, url = FORM_PAGE } = {}) {
  const page = await browser.newPage({ viewport, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (gasUrl) {
    await page.route('**/js/reservation.js', async (route) => {
      const original = fs.readFileSync(FORM_JS, 'utf8');
      const js = original.replace('const GAS_URL = "";', `const GAS_URL = "${gasUrl}";`);
      assert.notEqual(js, original, 'reservation.js の GAS_URL の行が見つかりません');
      await route.fulfill({ contentType: 'text/javascript', body: js });
    });
  }
  await page.goto(url);
  page.jsErrors = errors;
  return page;
}

async function fillValid(page, over = {}) {
  const v = {
    name: '佐藤 花子', kana: 'さとう はなこ', tel: '090-1234-5678', email: 'hanako@example.com',
    type: '予防接種', visit: '初診', date1: OPEN_DAY, time1: '午前', message: 'テスト送信です。', ...over,
  };
  await page.fill('#f-name', v.name);
  await page.fill('#f-kana', v.kana);
  await page.fill('#f-tel', v.tel);
  await page.fill('#f-mail', v.email);
  await page.selectOption('#f-type', v.type);
  await page.check(`input[name=visit][value="${v.visit}"]`);
  await page.fill('#f-date1', v.date1);
  await page.selectOption('#f-time1', v.time1);
  await page.fill('#f-message', v.message);
  await page.check('#f-agree');
}

test('画面写真（PC・スマホ）とレイアウト崩れの確認', async () => {
  const pc = await openPage();
  await pc.screenshot({ path: path.join(SHOTS, 'pc.png'), fullPage: true });
  const sp = await openPage({ viewport: { width: 390, height: 844 } });
  await sp.screenshot({ path: path.join(SHOTS, 'sp.png'), fullPage: true });
  // 横スクロールが出ていない
  const overflow = await sp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `スマホで横にはみ出しています（${overflow}px）`);
  // サイト共通のロゴ（assets/images/logo.png）が読み込めている
  assert.equal(await pc.getAttribute('.brand-image', 'src'), 'assets/images/logo.png');
  assert.ok(await pc.evaluate(() => document.querySelector('.brand-image').naturalWidth > 0));
  // 迷惑送信よけの欄は画面の外にあり、人には見えない
  const trap = await pc.locator('#f-website').boundingBox();
  assert.ok(!trap || trap.x + trap.width <= 0, '迷惑送信よけの欄が画面内に見えています');
  assert.deepEqual(pc.jsErrors, []);
  await pc.close(); await sp.close();
});

test('空のまま送信：エラー一覧と各欄のエラーが出る', async () => {
  const page = await openPage();
  await page.click('.submit-button');
  const summary = page.locator('#f-error-summary');
  await summary.waitFor({ state: 'visible' });
  // 名前・ふりがな・電話・内容・初診/再診・第1希望・同意（初診・再診は最初から選んでいない）
  assert.equal(await summary.locator('li').count(), 7);
  assert.match(await page.textContent('#f-visit-error'), /初診・再診を選択/);
  assert.equal(await page.getAttribute('#f-name', 'aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'f-error-summary');
  await page.screenshot({ path: path.join(SHOTS, 'errors.png'), fullPage: true });
  // 一覧のリンクで、その欄に移動する
  await summary.locator('a').first().click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'f-name');
  // 直したらすぐエラーが消える
  await page.fill('#f-name', '佐藤 花子');
  assert.equal(await page.textContent('#f-name-error'), '');
  assert.equal(await page.getAttribute('#f-name', 'aria-invalid'), null);
  // 送信されていない（ページは移動しない）
  assert.equal(new URL(page.url()).pathname, '/reservation.html');
  await page.close();
});

test('入力の整え：カタカナ→ひらがな、全角の電話番号→半角', async () => {
  const page = await openPage();
  await page.fill('#f-kana', 'サトウ ハナコ');
  await page.fill('#f-tel', '０９０ー１２３４ー５６７８');
  await page.click('#f-name');
  assert.equal(await page.inputValue('#f-kana'), 'さとう はなこ');
  assert.equal(await page.inputValue('#f-tel'), '090-1234-5678');
  await page.close();
});

test('電話番号：英字が混ざっていたらエラー（Code.gs と同じルール）', async () => {
  const page = await openPage();
  await page.fill('#f-tel', '090a1234-5678');
  await page.click('#f-name');
  assert.match(await page.textContent('#f-tel-error'), /0から始まる10〜11桁/);
  await page.close();
});

test('希望日：木曜はエラー、土曜は午後を選べない', async () => {
  const page = await openPage();
  await page.fill('#f-date1', THURSDAY);
  await page.dispatchEvent('#f-date1', 'change');
  assert.match(await page.textContent('#f-date1-error'), /木曜日は休診日/);
  await page.fill('#f-date1', SATURDAY);
  await page.dispatchEvent('#f-date1', 'change');
  assert.equal(await page.locator('#f-time1 option[value="午後"]').isDisabled(), true);
  assert.equal(await page.textContent('#f-time1 option[value="午後"]'), '午後（土曜は休診）');
  assert.equal(await page.textContent('#f-date1-error'), '');
  // 平日に選び直すと、「午後」が元に戻って選べる（土曜→平日→土曜でも壊れない）
  await page.fill('#f-date1', OPEN_DAY);
  await page.dispatchEvent('#f-date1', 'change');
  assert.equal(await page.locator('#f-time1 option[value="午後"]').isDisabled(), false);
  assert.equal(await page.textContent('#f-time1 option[value="午後"]'), '午後');
  await page.selectOption('#f-time1', '午後');
  await page.fill('#f-date1', SATURDAY);
  await page.dispatchEvent('#f-date1', 'change');
  assert.equal(await page.inputValue('#f-time1'), '');
  assert.deepEqual(page.jsErrors, []);
  // 明日より前は選べないよう min が付いている
  assert.ok((await page.getAttribute('#f-date1', 'min')) > ymd(new Date()));
  await page.close();
});

test('Google未接続（GAS_URLが空）：完了ページにテスト表示の受付番号が出る', async () => {
  const page = await openPage();
  await fillValid(page);
  await page.click('.submit-button');
  await page.waitForURL('**/reservation-complete.html?*');
  await page.locator('#complete-receipt').waitFor({ state: 'visible' });
  assert.equal(await page.textContent('#complete-receipt-id'), 'TEST-000000');
  assert.equal(await page.locator('#complete-demo-note').isVisible(), true);
  // 入力内容は URL に載らない
  assert.equal(new URL(page.url()).search, '?id=TEST-000000&demo=1');
  await page.close();
});

test('Apps Scriptへ送信：完了ページに受付番号が出て、医院への通知と自動返信が送られる', async () => {
  const page = await openPage({ gasUrl: GAS });
  await fillValid(page, { kana: 'サトウ ハナコ', visit: '再診' });
  await page.fill('#f-date2', SATURDAY);
  await page.dispatchEvent('#f-date2', 'change');
  await page.selectOption('#f-time2', '午前');
  await page.click('.submit-button');
  await page.waitForURL('**/reservation-complete.html?*');
  await page.locator('#complete-receipt').waitFor({ state: 'visible' });
  assert.match(await page.textContent('#complete-receipt-id'), /^SATO-\d{6}-0001$/);
  assert.equal(await page.locator('#complete-demo-note').isVisible(), false);
  // 完了ページの既存の文言はそのまま
  assert.equal(await page.textContent('#complete-heading'), 'ご予約・ご相談を受け付けました');
  await page.screenshot({ path: path.join(SHOTS, 'complete.png'), fullPage: true });

  const { sent, rows } = await (await fetch(`http://localhost:${GAS_PORT}/sent`)).json();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'kazuhide.aoki@gmail.com');
  assert.equal(sent[0].opt.replyTo, 'hanako@example.com');
  assert.equal(sent[1].to, 'hanako@example.com');
  assert.equal(rows[1][3], 'さとう はなこ');
  assert.equal(rows[1][7], '再診');
  assert.equal(rows[1][10], SATURDAY);
  assert.deepEqual(page.jsErrors, []);
  await page.close();
});

test('サーバー側でエラー：その欄にエラーを表示し、ページは移動しない', async () => {
  const page = await openPage({ gasUrl: GAS });
  await fillValid(page);
  // 画面のチェックをすり抜けた想定で、送信直前に値を書き換える
  await page.evaluate(() => { const o = document.querySelector('#f-type option:last-child'); o.value = '整形外科'; o.selected = true; });
  await page.click('.submit-button');
  await page.locator('#f-error-summary').waitFor({ state: 'visible' });
  assert.match(await page.textContent('#f-type-error'), /ご希望の内容を選択/);
  assert.equal(new URL(page.url()).pathname, '/reservation.html');
  await page.close();
});

test('通信できない：電話番号つきのお詫びを表示し、もう一度送れる', async () => {
  const page = await openPage({ gasUrl: 'http://localhost:1/exec' });
  await fillValid(page);
  await page.click('.submit-button');
  await page.locator('#f-error-summary').waitFor({ state: 'visible' });
  assert.match(await page.textContent('#f-error-summary'), /送信できませんでした[\s\S]*00-0000-0000/);
  assert.equal(await page.isEnabled('.submit-button'), true);
  assert.equal(await page.textContent('.submit-button'), '送信する');
  await page.close();
});

test('完了ページ：受付番号がない・形が違うときは表示しない', async () => {
  for (const query of ['', '?id=%3Cb%3Ex%3C%2Fb%3E', '?id=TEST-000000']) {
    const page = await openPage({ url: `${SITE}/reservation-complete.html${query}` });
    assert.equal(await page.locator('#complete-receipt').isVisible(), false, `表示されてしまった：${query}`);
    assert.equal(await page.textContent('#complete-receipt-id'), '');
    assert.deepEqual(page.jsErrors, []);
    await page.close();
  }
});

test('スマホ：メニューの開閉（サイト共通の js/main.js）', async () => {
  const page = await openPage({ viewport: { width: 390, height: 844 } });
  assert.equal(await page.locator('#primary-navigation').isVisible(), false);
  await page.click('.nav-toggle');
  assert.equal(await page.locator('#primary-navigation').isVisible(), true);
  assert.equal(await page.getAttribute('.nav-toggle', 'aria-expanded'), 'true');
  await page.screenshot({ path: path.join(SHOTS, 'sp-menu.png') });
  await page.close();
});
