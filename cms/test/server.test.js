'use strict';
const assert = require('assert');
const path = require('path');
const { createWorld, Spreadsheet } = require('./mock-gas');

const FORM = process.argv[2];
const ADMIN = path.join(__dirname, '../admin/Code.gs');
const SSID = '1VzX1V6KCbPMUm9Bad5F2D1DA5DxUNMTtX-36LPnniXc';

function setup() {
  const world = createWorld();
  world.errors = [];
  world.spreadsheets[SSID] = new Spreadsheet(SSID, '佐藤医院 ご予約・ご相談 受付一覧');
  world.props[FORM + 'SPREADSHEET_ID'] = SSID;
  const form = world.makeContext(FORM);
  const admin = world.makeContext(ADMIN);
  return { world, form, admin };
}
const json = (out) => JSON.parse(out.getContent());

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }

test('初回設定：シートが作られ、原稿の内容が入る', () => {
  const { form, admin } = setup();
  form.setup();
  admin.setupCms();
  const news = admin.getNews();
  assert.equal(news.length, 5);
  assert.deepEqual(news.map((x) => x.id), ['news-1', 'news-2', 'news-3', 'news-4', 'news-5']);
  assert.equal(admin.getFaq().length, 11);
  assert.equal(admin.getFaq().filter((x) => x.top).length, 5);
  admin.setupCms(); // 2回目は何も足さない
  assert.equal(admin.getNews().length, 5);
});

test('公開サイト用：公開の行だけ、並び順どおり、段落に分けて返す', () => {
  const { form, admin } = setup();
  form.setup(); admin.setupCms();
  admin.setNewsStatus('news-2', '非公開');
  const out = json(form.doGet({ parameter: { type: 'news' } }));
  assert.equal(out.ok, true);
  assert.deepEqual(out.items.map((x) => x.id), ['news-1', 'news-3', 'news-4', 'news-5']);
  assert.ok(Array.isArray(out.items[0].body));
  const faq = json(form.doGet({ parameter: { type: 'faq' } }));
  assert.equal(faq.items.length, 11);
  assert.equal(faq.categories.length, 4);
  assert.ok(faq.items[0].answer[0].includes('[Web予約](reservation.html)'));
  assert.ok(form.doGet({ parameter: {} }).getContent().includes('正常に公開'));
});

test('お知らせ：新規は先頭に入り、編集・並べ替え・公開切り替えができる', () => {
  const { form, admin } = setup();
  form.setup(); admin.setupCms();
  let rows = admin.saveNews({ title: '臨時休診のお知らせ', date: '2026-11-20', body: '1行目\n\n2行目', status: '公開' });
  assert.equal(rows[0].title, '臨時休診のお知らせ');
  assert.equal(rows.length, 6);
  const id = rows[0].id;
  const pub = json(form.doGet({ parameter: { type: 'news' } }));
  assert.equal(pub.items[0].id, id);
  assert.deepEqual(pub.items[0].body, ['1行目', '2行目']);
  assert.equal(pub.items[0].date, '2026-11-20');
  rows = admin.saveNews({ id, title: '臨時休診のお知らせ（変更）', date: '', body: '本文', status: '非公開' });
  assert.equal(rows.length, 6);
  assert.equal(rows[0].title, '臨時休診のお知らせ（変更）');
  assert.equal(json(form.doGet({ parameter: { type: 'news' } })).items.length, 5);
  rows = admin.moveNews(id, 'down');
  assert.equal(rows[1].id, id);
  assert.deepEqual(rows.map((x) => x.order), [1, 2, 3, 4, 5, 6]);
  rows = admin.moveNews('news-5', 'down'); // いちばん下はそのまま
  assert.equal(rows[5].id, 'news-5');
  assert.throws(() => admin.saveNews({ title: '', body: 'x', status: '公開' }), /タイトル/);
  assert.throws(() => admin.saveNews({ title: 'x', body: 'x', date: '2026-02-30', status: '公開' }), /掲載日/);
});

test('よくあるご質問：保存・トップ表示・数式よけ', () => {
  const { form, admin } = setup();
  form.setup(); admin.setupCms();
  let rows = admin.saveFaq({ category: 'その他', question: '=1+1 はいくつ？', answer: '答え', top: true, status: '公開' });
  assert.equal(rows[0].question, '=1+1 はいくつ？');
  assert.equal(rows[0].top, true);
  assert.throws(() => admin.saveFaq({ category: 'なし', question: 'q', answer: 'a', status: '公開' }), /分類/);
  const pub = json(form.doGet({ parameter: { type: 'faq' } }));
  assert.equal(pub.items[0].question, '=1+1 はいくつ？');
});

test('ご相談：フォームの受付が一覧に出て、対応状況とメモを保存できる', () => {
  const { world, form, admin } = setup();
  form.setup(); admin.setupCms();
  form.testSubmit();
  form.doPost({ parameter: { name: '佐藤 次郎', kana: 'さとう じろう', tel: '03-1234-5678', email: '', type: '一般診療', visit: '再診', date1: nextOpenDay(), time1: '午前', message: '', agree: '同意する' } });
  let list = admin.getInquiries();
  assert.equal(list.length, 2);
  assert.equal(list[0].name, '佐藤 次郎'); // 新しい順
  assert.equal(list[0].status, '未対応');
  assert.equal(list[0].tel, '03-1234-5678');
  const x = admin.updateInquiry(list[0].id, { status: '対応中', memo: '折り返し電話済み' });
  assert.equal(x.status, '対応中');
  assert.equal(x.memo, '折り返し電話済み');
  assert.throws(() => admin.updateInquiry(list[0].id, { status: 'その他' }), /対応状況/);
  assert.throws(() => admin.updateInquiry('SATO-000', { status: '完了' }), /見つかりません/);
  assert.equal(world.errors.length, 0, world.errors.join('\n'));
});

function nextOpenDay() {
  const d = new Date(Date.now() + 9 * 3600e3);
  do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 4, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

console.log(n + ' tests passed');
