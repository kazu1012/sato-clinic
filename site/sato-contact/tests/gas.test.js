// gas/Code.gs のテスト（Googleのサービスを偽物に置き換えてNodeで動かす）
// 実行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

// 2026-11-12（木）を「今日」とする
const FIXED_NOW = new Date('2026-11-12T10:00:00+09:00');

function makeEnv({ now = FIXED_NOW } = {}) {
  const sent = [];
  const rows = [];
  const props = {};
  const cache = {};
  let created = 0;

  const sheet = {
    getLastRow: () => rows.length,
    appendRow: (r) => rows.push(r),
    setFrozenRows: () => {},
    getRange: () => ({ setFontWeight() { return this; }, setBackground() { return this; } }),
    setName: () => {},
    getParent: () => ss,
  };
  const ss = {
    getId: () => 'SS1',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/SS1',
    getSheetByName: () => (created ? sheet : null),
    getSheets: () => [sheet],
  };

  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now.getTime()); }
    static now() { return now.getTime(); }
  }

  const ctx = {
    console: { log() {}, error() {} },
    Date: FakeDate,
    MailApp: { sendEmail: (to, subject, body, opt) => sent.push({ to, subject, body, opt: opt || {} }) },
    SpreadsheetApp: {
      create: () => { created++; return ss; },
      openById: (id) => { if (id !== 'SS1') throw new Error('not found'); return ss; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      // Asia/Tokyo 固定の簡易版
      formatDate: (d, tz, fmt) => {
        const j = new Date(d.getTime() + 9 * 3600e3);
        const p = (n, w = 2) => String(n).padStart(w, '0');
        return fmt
          .replace('yyyy', j.getUTCFullYear()).replace('yy', String(j.getUTCFullYear()).slice(2))
          .replace('MM', p(j.getUTCMonth() + 1)).replace('dd', p(j.getUTCDate()))
          .replace('HH', p(j.getUTCHours())).replace('mm', p(j.getUTCMinutes())).replace('ss', p(j.getUTCSeconds()));
      },
      base64EncodeWebSafe: (s) => Buffer.from(s).toString('base64url'),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const post = (parameter) => JSON.parse(ctx.doPost({ parameter }).getContent());
  return { ctx, post, sent, rows, props };
}

// 正しい入力（2026-11-13は金曜）
const valid = (over = {}) => ({
  name: '佐藤 花子', kana: 'さとう はなこ', tel: '090-1234-5678', email: 'hanako@example.com',
  type: '予防接種', visit: '初診', date1: '2026-11-13', time1: '午前', date2: '', time2: '',
  message: '予防接種の予約をしたいです。', agree: '同意する', website: '', ...over,
});

test('正しい入力：受付番号を返し、シートに1行、メール2通', () => {
  const env = makeEnv();
  const r = env.post(valid());
  assert.equal(r.ok, true);
  assert.equal(r.id, 'SATO-261112-0001');
  assert.equal(env.rows.length, 2); // 見出し＋1件
  assert.equal(env.rows[0][0], '受付番号');
  assert.equal(env.rows[1][4], "'090-1234-5678"); // 電話番号は文字列として保存
  assert.equal(env.rows[1][13], '未対応');
  assert.equal(env.sent.length, 2);
});

test('通知メール：医院宛て、返信先＝相談者', () => {
  const env = makeEnv();
  env.post(valid());
  const n = env.sent[0];
  assert.equal(n.to, 'sato.clinic.test2026@gmail.com');
  assert.equal(n.opt.replyTo, 'hanako@example.com');
  assert.match(n.subject, /^【Web予約・相談】予防接種／佐藤 花子様（SATO-261112-0001）$/);
  assert.match(n.body, /このメールに「返信」すると、相談者（hanako@example.com）に届きます/);
  assert.match(n.body, /2026年11月13日（金）　午前/);
});

test('自動返信：相談者宛てに受付番号つきで届く', () => {
  const env = makeEnv();
  env.post(valid());
  const a = env.sent[1];
  assert.equal(a.to, 'hanako@example.com');
  assert.equal(a.opt.name, '佐藤医院');
  assert.match(a.subject, /SATO-261112-0001/);
  assert.match(a.body, /^佐藤 花子 様/);
});

test('メールなし：通知のみ、返信先なし、電話で連絡と案内', () => {
  const env = makeEnv();
  const r = env.post(valid({ email: '' }));
  assert.equal(r.ok, true);
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].opt.replyTo, undefined);
  assert.match(env.sent[0].body, /お電話（090-1234-5678）でご連絡ください/);
});

test('受付番号は連番になり、シートは1つだけ作る', () => {
  const env = makeEnv();
  env.post(valid());
  const r2 = env.post(valid({ email: 'other@example.com' }));
  assert.equal(r2.id, 'SATO-261112-0002');
  assert.equal(env.props.SPREADSHEET_ID, 'SS1');
});

test('必須項目が空：それぞれのエラーを返し、何も送らない', () => {
  const env = makeEnv();
  const r = env.post({});
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['agree', 'date1', 'kana', 'name', 'tel', 'type', 'visit'].sort());
  assert.equal(env.sent.length, 0);
  assert.equal(env.rows.length, 0);
});

test('入力の整え：全角数字・カタカナ・全角メールを直して受け付ける', () => {
  const env = makeEnv();
  const r = env.post(valid({ tel: '０９０ー１２３４ー５６７８', kana: 'サトウ ハナコ', email: 'ｈａｎａｋｏ＠ｅｘａｍｐｌｅ．ｃｏｍ' }));
  assert.equal(r.ok, true);
  assert.equal(env.rows[1][3], 'さとう はなこ');
  assert.equal(env.rows[1][4], "'090-1234-5678");
  assert.equal(env.rows[1][5], 'hanako@example.com');
});

test('誤った形式：電話・メール・ふりがな・選択肢', () => {
  const env = makeEnv();
  const r = env.post(valid({ tel: '12345', email: 'abc@', kana: 'Sato', type: '整形外科', visit: '?' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.tel && r.errors.email && r.errors.kana && r.errors.type && r.errors.visit);
});

test('希望日：今日・木曜・日曜・土曜午後・3か月超はエラー、土曜午前はOK', () => {
  const env = makeEnv();
  const e = (date1, time1 = '午前') => env.post(valid({ date1, time1 })).errors;
  assert.match(e('2026-11-12').date1, /明日以降/);    // 今日
  assert.match(e('2026-11-19').date1, /木曜日/);
  assert.match(e('2026-11-15').date1, /日曜日/);
  assert.match(e('2026-11-14', '午後').date1, /土曜日の午後/);
  assert.match(e('2027-03-01').date1, /3か月以内/);
  assert.match(e('2026-13-40').date1, /日付を選択/);
  assert.equal(env.post(valid({ date1: '2026-11-14', time1: '午前' })).ok, true);
});

test('第2希望：時間帯なし・第1希望と同じはエラー', () => {
  const env = makeEnv();
  assert.match(env.post(valid({ date2: '2026-11-16', time2: '' })).errors.date2, /時間帯/);
  assert.match(env.post(valid({ date2: '2026-11-13', time2: '午前' })).errors.date2, /別の日時/);
  assert.match(env.post(valid({ date2: '', time2: '午後' })).errors.date2, /日付を選択/);
  assert.equal(env.post(valid({ date2: '2026-11-16', time2: '午後' })).ok, true);
});

test('迷惑送信よけ：見えない欄に入力があれば、成功のふりをして何もしない', () => {
  const env = makeEnv();
  const r = env.post(valid({ website: 'http://spam.example' }));
  assert.equal(r.ok, true);
  assert.equal(env.sent.length, 0);
  assert.equal(env.rows.length, 0);
});

test('数式の実行よけ：= で始まる入力は文字列として保存', () => {
  const env = makeEnv();
  env.post(valid({ name: '=HYPERLINK("http://x")', message: '+1234' }));
  assert.equal(env.rows[1][2], '\'=HYPERLINK("http://x")');
  assert.equal(env.rows[1][12], "'+1234");
});

test('件名に改行を混ぜられない', () => {
  const env = makeEnv();
  env.post(valid({ name: '佐藤\nBcc: x@example.com' }));
  assert.ok(!/\n/.test(env.sent[0].subject));
});

test('同じアドレスへの自動返信は10分に1回まで（通知は毎回届く）', () => {
  const env = makeEnv();
  env.post(valid());
  env.post(valid());
  const toUser = env.sent.filter((m) => m.to === 'hanako@example.com');
  const toClinic = env.sent.filter((m) => m.to === 'sato.clinic.test2026@gmail.com');
  assert.equal(toUser.length, 1);
  assert.equal(toClinic.length, 2);
});

test('1時間に30件を超えたら受け付けない', () => {
  const env = makeEnv();
  for (let i = 0; i < 30; i++) assert.equal(env.post(valid({ email: '' })).ok, true);
  const r = env.post(valid({ email: '' }));
  assert.equal(r.ok, false);
  assert.match(r.errors._, /混み合って/);
});

test('メール送信で失敗しても、エラーをJSONで返す', () => {
  const env = makeEnv();
  env.ctx.MailApp.sendEmail = () => { throw new Error('quota'); };
  const r = env.post(valid());
  assert.equal(r.ok, false);
  assert.match(r.errors._, /エラー/);
});

test('ご相談内容は1000文字まで', () => {
  const env = makeEnv();
  assert.equal(env.post(valid({ message: 'あ'.repeat(1000) })).ok, true);
  assert.match(env.post(valid({ message: 'あ'.repeat(1001) })).errors.message, /1000文字/);
});

test('testSubmit()（エディタ用）が動く', () => {
  const env = makeEnv();
  env.ctx.testSubmit();
  assert.equal(env.sent.length, 2);
  assert.match(env.sent[0].body, /2026年11月13日（金）/);
});
