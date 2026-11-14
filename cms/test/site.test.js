'use strict';
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');
const { createWorld, Spreadsheet } = require('./mock-gas');
const SITE = process.argv[2];
const FORM = path.join(SITE, 'sato-contact/gas/Code.gs');
const SSID = '1VzX1V6KCbPMUm9Bad5F2D1DA5DxUNMTtX-36LPnniXc';

(async () => {
  const world = createWorld(); world.errors = [];
  world.spreadsheets[SSID] = new Spreadsheet(SSID, 'x');
  world.props[FORM + 'SPREADSHEET_ID'] = SSID;
  const form = world.makeContext(FORM);
  const admin = world.makeContext(path.join(__dirname, '../admin/Code.gs'));
  form.setup(); admin.setupCms();
  const browser = await chromium.launch();

  async function open(file, mode) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://script.google.com/**', (route) => {
      if (mode === 'down') return route.abort();
      const type = new URL(route.request().url()).searchParams.get('type');
      route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: form.doGet({ parameter: { type } }).getContent() });
    });
    await page.goto('file://' + path.join(SITE, file));
    await page.waitForTimeout(600);
    page.errors = errors;
    return page;
  }
  const text = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.replace(/\s+/g, '')));

  // 1) 初期データのままなら、表示はもとの HTML と同じ
  let down = await open('faq.html', 'down');
  const original = await text(down, '[data-faq-archive]');
  const originalHtml = await down.$eval('[data-faq-archive]', (e) => e.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim());
  let live = await open('faq.html', 'live');
  const a1 = await text(live, '[data-faq-archive]'); if (a1[0] !== original[0]) { for (let i=0;i<a1[0].length;i++) if (a1[0][i]!==original[0][i]) { console.log('DIFF@',i, JSON.stringify(original[0].slice(0,i+40)), '|||', JSON.stringify(a1[0].slice(0,i+40))); break; } }
  assert.deepEqual(a1, original);
  assert.equal(await live.locator('[data-faq-archive] a[href="reservation.html"]').count(), 1);
  assert.equal(await live.locator('#faq-cat-4').count(), 1);
  let top = await open('index.html', 'live');
  const topDown = await open('index.html', 'down');
  assert.deepEqual(await text(top, '[data-faq-top] li'), await text(topDown, '[data-faq-top] li'));
  assert.deepEqual(await text(top, '[data-news-list] li'), await text(topDown, '[data-news-list] li'));
  console.log('ok 初期データでは見た目が変わらない');

  // 2) 院内システムで変えると、サイトに出る
  admin.saveNews({ title: '臨時休診のお知らせ', date: '2026-11-20', body: '11月20日は休診します。\n[ご予約・ご相談](reservation.html)からご連絡ください。', status: '公開' });
  admin.setNewsStatus('news-5', '非公開');
  admin.saveFaq({ category: 'その他', question: '自転車は停められますか？', answer: 'はい、駐輪場があります。', top: true, status: '公開' });
  admin.setFaqStatus('faq-wifi', '非公開');
  top = await open('index.html', 'live');
  const news = await text(top, '[data-news-list] li');
  assert.equal(news.length, 5);
  assert.ok(news[0].startsWith('2026年11月20日臨時休診'));
  assert.ok(!news.some((t) => t.includes('オンライン診療')));
  const topFaq = await text(top, '[data-faq-top] li');
  assert.equal(topFaq.length, 5);
  assert.ok(topFaq[0].includes('自転車'));
  const newsPage = await open('news.html', 'live');
  assert.equal(await newsPage.locator('.news-entry').count(), 5);
  assert.equal(await newsPage.locator('.news-entry').first().locator('a[href="reservation.html"]').count(), 1);
  const faqPage = await open('faq.html', 'live');
  const faqText = (await text(faqPage, '[data-faq-archive]'))[0];
  assert.ok(faqText.includes('自転車は停められますか'));
  assert.ok(!faqText.includes('Wi-Fi'));
  await faqPage.screenshot({ path: '/home/claude/cms/shots/site-faq.png', fullPage: true });
  await newsPage.screenshot({ path: '/home/claude/cms/shots/site-news.png', fullPage: true });
  console.log('ok 院内システムの変更がサイトに反映される');

  // 3) 読み込めないときは、もとの内容のまま
  down = await open('news.html', 'down');
  assert.equal(await down.locator('.news-entry').count(), 5);
  assert.ok((await text(down, '.news-entry h2'))[4].includes('オンライン診療'));
  console.log('ok 通信できないときは、もとの内容で表示');

  for (const p of [down, live, top, topDown, newsPage, faqPage]) assert.deepEqual(p.errors, []);
  await browser.close();
  console.log('site tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
