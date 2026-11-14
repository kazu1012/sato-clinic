'use strict';
// 院内システムの画面を、まねの Apps Script につないで動かすテスト
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { createWorld, Spreadsheet } = require('./mock-gas');

const FORM = process.argv[2];
const OUT = process.argv[3] || '/tmp/cms-shots';
const SSID = '1VzX1V6KCbPMUm9Bad5F2D1DA5DxUNMTtX-36LPnniXc';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const world = createWorld(); world.errors = [];
  world.spreadsheets[SSID] = new Spreadsheet(SSID, '受付一覧');
  world.props[FORM + 'SPREADSHEET_ID'] = SSID;
  const form = world.makeContext(FORM);
  const admin = world.makeContext(path.join(__dirname, '../admin/Code.gs'));
  form.setup(); admin.setupCms(); form.testSubmit();
  form.doPost({ parameter: { name: '佐藤 次郎', kana: 'さとう じろう', tel: '03-1234-5678', email: '', type: '一般診療', visit: '再診', date1: '2026-11-16', time1: '午前', message: '', agree: '同意する' } });

  const html = fs.readFileSync(path.join(__dirname, '../admin/index.html'), 'utf8');
  const browser = await chromium.launch();
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.exposeFunction('__gas', (name, args) => {
      try { return { ok: true, value: JSON.parse(JSON.stringify(admin[name](...args) ?? null)) }; }
      catch (e) { return { ok: false, message: e.message }; }
    });
    await page.addInitScript(() => {
      function runner(success, failure) {
        return new Proxy({}, { get(_, name) {
          if (name === 'withSuccessHandler') return (f) => runner(f, failure);
          if (name === 'withFailureHandler') return (f) => runner(success, f);
          return (...args) => window.__gas(name, args).then((r) => (r.ok ? success && success(r.value) : failure && failure(new Error(r.message))));
        } });
      }
      window.google = { script: { run: runner() } };
    });
    await page.route('https://admin.test/', (r) => r.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://admin.test/');
    await page.waitForSelector('.card');
    const shot = (n) => page.screenshot({ path: `${OUT}/${width}-${n}.png`, fullPage: true });

    // ご相談
    assert.equal(await page.locator('.card').count(), 2);
    const open = admin.getInquiries().filter((x) => x.status === '未対応').length;
    assert.equal(await page.locator('#badge-new').textContent(), String(open));
    await shot('01-inquiry-list');
    await page.locator('.card.is-new').first().click();
    await page.waitForSelector('#inquiry-detail-title');
    await page.getByRole('button', { name: '完了' }).click();
    await page.waitForFunction((n) => document.querySelector('#badge-new').textContent === String(n), open - 1);
    await page.fill('#inquiry-memo', '電話で予約確定');
    await page.getByRole('button', { name: 'メモを保存' }).click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('メモ'));
    await shot('02-inquiry-detail');
    await page.getByRole('button', { name: '← 一覧に戻る' }).click();
    await page.locator('.card', { hasText: 'テスト 花子' }).click();
    const href = await page.getByRole('link', { name: 'Gmail で返信する' }).getAttribute('href');
    assert.ok(href.startsWith('https://mail.google.com/mail/?authuser=sato.clinic.test2026%40gmail.com&view=cm'));
    assert.ok(decodeURIComponent(href).includes('su=【佐藤医院】ご予約・ご相談の件（SATO-'));
    await page.getByRole('button', { name: '← 一覧に戻る' }).click();
    await page.locator('.filter', { hasText: '完了' }).click();
    assert.equal(await page.locator('.card').count(), admin.getInquiries().filter((x) => x.status === '完了').length);

    // お知らせ
    await page.getByRole('tab', { name: 'お知らせ' }).click();
    assert.equal(await page.locator('#news-list .row').count(), width === 1280 ? 5 : 6);
    await shot('03-news-list');
    await page.getByRole('button', { name: '＋ 新しいお知らせを書く' }).click();
    await page.getByRole('button', { name: '保存する' }).click();
    assert.ok((await page.textContent('.error-box')).includes('タイトル'));
    await page.fill('#f-title', '臨時休診のお知らせ' + width);
    await page.fill('#f-date', '2026-11-20');
    await page.fill('#f-body', '11月20日（金）は臨時休診とさせていただきます。\n詳しくは[お電話](tel:0000000000)でお問い合わせください。');
    await page.getByRole('button', { name: 'プレビューを見る' }).click();
    assert.ok((await page.textContent('.preview')).includes('2026年11月20日'));
    assert.equal(await page.locator('.preview a[href="tel:0000000000"]').count(), 1);
    await shot('04-news-edit-preview');
    await page.getByRole('button', { name: '保存する' }).click();
    await page.waitForSelector('#news-list-view:not([hidden])');
    assert.ok((await page.locator('#news-list .row-title').first().textContent()).startsWith('臨時休診'));
    await page.locator('#news-list .row').first().getByRole('button', { name: /1つ下へ/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('#news-list .row-title')[1].textContent.startsWith('臨時休診'));
    await page.locator('#news-list .row').nth(1).getByRole('button', { name: '非公開にする' }).click();
    await page.waitForFunction(() => document.querySelectorAll('#news-list .row')[1].classList.contains('is-private'));

    // よくあるご質問
    await page.getByRole('tab', { name: 'よくあるご質問' }).click();
    assert.ok((await page.textContent('#faq-hint')).includes('今 5 件'));
    await shot('05-faq-list');
    await page.locator('#faq-list .row').first().getByRole('button', { name: '編集' }).click();
    await page.getByRole('button', { name: 'プレビューを見る' }).click();
    assert.equal(await page.locator('.preview a[href="reservation.html"]').count(), 1);
    await shot('06-faq-edit-preview');
    await page.getByRole('button', { name: '← 一覧に戻る（保存しない）' }).click();

    assert.deepEqual(pageErrors, []);
    console.log('ok ui', width);
    await page.close();
  }
  // 公開サイト用の出口に反映されているか
  const pub = JSON.parse(form.doGet({ parameter: { type: 'news' } }).getContent());
  assert.equal(pub.items.filter((x) => x.title.startsWith('臨時休診')).length, 0); // どちらも非公開にした
  assert.equal(pub.items.length, 5);
  assert.equal(world.errors.length, 0, world.errors.join('\n'));
  await browser.close();
  console.log('ui tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
