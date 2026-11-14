/**
 * 佐藤医院 ご予約・ご相談フォーム 受付スクリプト（Google Apps Script）
 *
 * 流れ：
 *   フォーム送信 → doPost で受け取る
 *     → 入力チェック
 *     → スプレッドシート「受付一覧」に1行追加（受付番号つき）
 *     → 医院（CONFIG.NOTIFY_TO）へ通知メール。返信先＝相談者のメールアドレス
 *        ※Gmailでこのメールに「返信」すれば、そのまま相談者に届きます
 *     → 相談者がメールアドレスを入力していれば、受付確認メールを自動送信
 *
 * 初回だけ：エディタで setup を実行して権限を許可 → 「デプロイ」→「ウェブアプリ」で公開。
 * 詳しくは README.md を見てください。
 */

const CONFIG = {
  NOTIFY_TO: 'sato.clinic.test2026@gmail.com', // 通知メールの宛先（医院側）
  CLINIC_NAME: '佐藤医院',
  CLINIC_TEL: '00-0000-0000',
  SPREADSHEET_NAME: '佐藤医院 ご予約・ご相談 受付一覧',
  SHEET_NAME: '受付一覧',
  TIMEZONE: 'Asia/Tokyo',
  SEND_AUTO_REPLY: true,          // 相談者への受付確認メールを送るか
  MAX_PER_HOUR: 30,               // 1時間に受け付ける最大件数（いたずら・連打よけ）
  AUTO_REPLY_COOLDOWN_SEC: 600,   // 同じアドレスへの自動返信は10分に1回まで
  MAX_DAYS_AHEAD: 92,             // 何日先まで予約希望を受け付けるか（フォームは90日）
  TEST_NOTE: '※このメールは、教材用の架空の医院「佐藤医院」のフォームから送信されたテストです。',
};

const TYPES = ['一般診療', '予防接種', '健康診断', 'その他のご相談'];
const VISITS = ['初診', '再診'];
const TIMES = ['午前', '午後'];
const HEADERS = [
  '受付番号', '受付日時', 'お名前', 'ふりがな', '電話番号', 'メールアドレス',
  'ご希望の内容', '初診・再診', '第1希望日', '第1希望時間帯', '第2希望日', '第2希望時間帯',
  'ご相談内容', '対応状況', 'メモ',
];

/* ================= 受け口 ================= */

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};

    // 迷惑送信よけ：人には見えない欄に入力があったら、受け付けたふりをして何もしない
    if (p.website) return json_({ ok: true, id: 'OK' });

    const v = validate_(p, todayYmd_());
    if (!v.ok) return json_({ ok: false, errors: v.errors });

    if (!underRateLimit_()) {
      return json_({ ok: false, errors: { _: '現在、送信が混み合っています。時間をおいてお試しいただくか、お電話でご連絡ください。' } });
    }

    const data = v.data;
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    let id;
    try {
      id = appendRow_(data);
    } finally {
      lock.releaseLock();
    }

    sendNotification_(id, data);
    if (CONFIG.SEND_AUTO_REPLY && data.email && autoReplyAllowed_(data.email)) {
      sendAutoReply_(id, data);
    }
    return json_({ ok: true, id: id });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, errors: { _: '送信処理でエラーが発生しました。お手数ですが、お電話でご連絡ください。' } });
  }
}

// ブラウザでURLを開いたときの確認用
function doGet() {
  return ContentService.createTextOutput(CONFIG.CLINIC_NAME + ' ご予約・ご相談フォームの受付用URLです（正常に公開されています）。');
}

/* ================= 入力チェック（contact.js と同じルール） ================= */

function validate_(p, today) {
  const errors = {};
  const s = (k) => oneLine_(String(p[k] == null ? '' : p[k]));

  const name = s('name');
  const kana = kataToHira_(s('kana'));
  const tel = toHalfWidth_(s('tel')).replace(/[ー−‐―－]/g, '-').replace(/\s/g, '');
  const email = toHalfWidth_(s('email'));
  const type = s('type');
  const visit = s('visit');
  const date1 = s('date1'), time1 = s('time1');
  const date2 = s('date2'), time2 = s('time2');
  const message = String(p.message == null ? '' : p.message).replace(/\r\n?/g, '\n').trim();
  const agree = s('agree');

  if (!name) errors.name = 'お名前を入力してください。';
  else if (name.length > 50) errors.name = 'お名前は50文字以内で入力してください。';

  if (!kana) errors.kana = 'ふりがなを入力してください。';
  else if (!/^[ぁ-ゖー\s　]+$/.test(kana)) errors.kana = 'ふりがなは、ひらがなで入力してください。';
  else if (kana.length > 50) errors.kana = 'ふりがなは50文字以内で入力してください。';

  if (!tel) errors.tel = '電話番号を入力してください。';
  else if (!/^0\d{9,10}$/.test(tel.replace(/[^0-9]/g, '')) || !/^[0-9\-()]+$/.test(tel)) {
    errors.tel = '電話番号は、0から始まる10〜11桁の数字で入力してください。';
  }

  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
    errors.email = 'メールアドレスの形式が正しくありません。';
  }

  if (TYPES.indexOf(type) < 0) errors.type = 'ご希望の内容を選択してください。';
  if (VISITS.indexOf(visit) < 0) errors.visit = '初診・再診を選択してください。';

  if (!date1) errors.date1 = '第1希望の日付を選択してください。';
  else {
    const e1 = checkDate_(date1, time1, today);
    if (e1) errors.date1 = e1;
    else if (TIMES.indexOf(time1) < 0) errors.date1 = '第1希望の時間帯（午前／午後）を選択してください。';
  }

  if (date2 || time2) {
    if (!date2) errors.date2 = '第2希望の日付を選択してください。';
    else {
      const e2 = checkDate_(date2, time2, today);
      if (e2) errors.date2 = e2;
      else if (TIMES.indexOf(time2) < 0) errors.date2 = '第2希望の時間帯（午前／午後）を選択してください。';
      else if (date2 === date1 && time2 === time1) errors.date2 = '第1希望と別の日時を選択してください。';
    }
  }

  if (message.length > 1000) errors.message = 'ご相談内容は1000文字以内で入力してください。';
  if (!agree) errors.agree = '個人情報の取り扱いへの同意が必要です。';

  if (Object.keys(errors).length) return { ok: false, errors: errors };
  return {
    ok: true,
    data: {
      name: name, kana: kana, tel: tel, email: email, type: type, visit: visit,
      date1: date1, time1: time1, date2: date2, time2: date2 ? time2 : '', message: message,
    },
  };
}

// 希望日のルール：明日以降・木曜と日曜は休診・土曜は午前のみ
function checkDate_(ymd, time, today) {
  // 13月40日のような、ありえない日付もはじく
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || new Date(ymdToUtc_(ymd)).toISOString().slice(0, 10) !== ymd) {
    return '日付を選択してください。';
  }
  const diff = Math.round((ymdToUtc_(ymd) - ymdToUtc_(today)) / 86400000);
  if (diff < 1) return '明日以降の日付を選択してください。';
  if (diff > CONFIG.MAX_DAYS_AHEAD) return '3か月以内の日付を選択してください。';
  const w = new Date(ymdToUtc_(ymd)).getUTCDay();
  if (w === 4) return '木曜日は休診日です。別の日を選択してください。';
  if (w === 0) return '日曜日は休診日です。別の日を選択してください。';
  if (w === 6 && time === '午後') return '土曜日の午後は休診です。午前を選択してください。';
  return '';
}

/* ================= スプレッドシート ================= */

function getSheet_() {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const ssId = props.getProperty('SPREADSHEET_ID');
  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName(CONFIG.SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#EEF5F3');
  }
  return sheet;
}

function appendRow_(d) {
  const sheet = getSheet_();
  const now = new Date();
  const seq = sheet.getLastRow(); // 見出し行を除いた件数＋1 になる
  const id = 'SATO-' + Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyMMdd') + '-' + ('000' + seq).slice(-4);
  sheet.appendRow([
    id,
    Utilities.formatDate(now, CONFIG.TIMEZONE, 'yyyy/MM/dd HH:mm:ss'),
    cell_(d.name), cell_(d.kana),
    "'" + d.tel, // 先頭の0が消えないよう文字列として保存
    cell_(d.email), d.type, d.visit,
    d.date1, d.time1, d.date2, d.time2,
    cell_(d.message), '未対応', '',
  ]);
  return id;
}

// 「=」などで始まる入力を数式として実行させない
function cell_(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

/* ================= メール ================= */

function summaryText_(id, d) {
  const date = (ymd, t) => (ymd ? formatJpDate_(ymd) + '　' + t : '（なし）');
  return [
    '受付番号　　：' + id,
    'お名前　　　：' + d.name + '（' + d.kana + '）様',
    '電話番号　　：' + d.tel,
    'メール　　　：' + (d.email || '（入力なし）'),
    'ご希望の内容：' + d.type,
    '初診・再診　：' + d.visit,
    '第1希望　　 ：' + date(d.date1, d.time1),
    '第2希望　　 ：' + date(d.date2, d.time2),
    '',
    '【ご相談内容】',
    d.message || '（記入なし）',
  ].join('\n');
}

function sendNotification_(id, d) {
  const howToReply = d.email
    ? '▶ このメールに「返信」すると、相談者（' + d.email + '）に届きます。'
    : '▶ メールアドレスの入力がありません。お電話（' + d.tel + '）でご連絡ください。';
  const sheetUrl = getSheet_().getParent().getUrl();
  const body = [
    'Webフォームから、ご予約・ご相談が届きました。',
    howToReply,
    '',
    summaryText_(id, d),
    '',
    '────────────',
    '受付一覧（スプレッドシート）：' + sheetUrl,
    CONFIG.TEST_NOTE,
  ].join('\n');

  const options = { name: CONFIG.CLINIC_NAME + ' Webフォーム' };
  if (d.email) options.replyTo = d.email;
  MailApp.sendEmail(
    CONFIG.NOTIFY_TO,
    '【Web予約・相談】' + d.type + '／' + d.name + '様（' + id + '）',
    body,
    options
  );
}

function sendAutoReply_(id, d) {
  const body = [
    d.name + ' 様',
    '',
    'このたびは' + CONFIG.CLINIC_NAME + 'にご予約・ご相談をいただき、ありがとうございます。',
    '以下の内容で受け付けました。',
    '',
    summaryText_(id, d),
    '',
    '送信後、当院より確認のご連絡をいたします。ご連絡をもってご予約の確定となります。',
    'お急ぎの場合は、お電話でご連絡ください。',
    '',
    '────────────',
    CONFIG.CLINIC_NAME,
    '〒123-4567　東京都台東区上野0-0-0',
    'TEL：' + CONFIG.CLINIC_TEL,
    '受付時間：午前 8:00〜11:00 ／ 午後 12:00〜17:00',
    '休診日：木曜・土曜午後・日曜',
    '────────────',
    '※このメールは送信専用の自動送信です。お心当たりのない場合は、お手数ですが破棄してください。',
    CONFIG.TEST_NOTE,
  ].join('\n');

  MailApp.sendEmail(
    d.email,
    '【' + CONFIG.CLINIC_NAME + '】ご予約・ご相談を受け付けました（' + id + '）',
    body,
    { name: CONFIG.CLINIC_NAME }
  );
}

/* ================= いたずら・連打よけ ================= */

function underRateLimit_() {
  const cache = CacheService.getScriptCache();
  const key = 'count_' + Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMddHH');
  const n = Number(cache.get(key) || 0);
  if (n >= CONFIG.MAX_PER_HOUR) return false;
  cache.put(key, String(n + 1), 3700);
  return true;
}

function autoReplyAllowed_(email) {
  const cache = CacheService.getScriptCache();
  const key = 'reply_' + Utilities.base64EncodeWebSafe(email.toLowerCase()).slice(0, 200);
  if (cache.get(key)) return false;
  cache.put(key, '1', CONFIG.AUTO_REPLY_COOLDOWN_SEC);
  return true;
}

/* ================= 小さな道具 ================= */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function todayYmd_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}
function ymdToUtc_(ymd) {
  const a = ymd.split('-').map(Number);
  return Date.UTC(a[0], a[1] - 1, a[2]);
}
function formatJpDate_(ymd) {
  const a = ymd.split('-').map(Number);
  const w = '日月火水木金土'.charAt(new Date(ymdToUtc_(ymd)).getUTCDay());
  return a[0] + '年' + a[1] + '月' + a[2] + '日（' + w + '）';
}
function oneLine_(s) {
  return s.replace(/[\r\n\t]+/g, ' ').trim(); // 件名などに改行を混ぜさせない
}
function toHalfWidth_(s) {
  return s.replace(/[０-９Ａ-Ｚａ-ｚ＠．－＿＋]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
}
function kataToHira_(s) {
  return s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
}

/* ================= 初回設定・テスト用（エディタから実行） ================= */

// ① 最初に1回実行：権限の許可と、受付一覧スプレッドシートの作成
function setup() {
  const sheet = getSheet_();
  console.log('受付一覧：' + sheet.getParent().getUrl());
  console.log('通知先：' + CONFIG.NOTIFY_TO);
}

// ② フォームを使わずに、受付〜メール送信までを試す（自分宛てに2通届きます）
function testSubmit() {
  const d = new Date(ymdToUtc_(todayYmd_()));
  do { d.setUTCDate(d.getUTCDate() + 1); } while ([0, 4, 6].indexOf(d.getUTCDay()) >= 0);
  const ymd = d.toISOString().slice(0, 10);
  const res = doPost({
    parameter: {
      name: 'テスト 花子', kana: 'てすと はなこ', tel: '00-0000-0000', email: CONFIG.NOTIFY_TO,
      type: '予防接種', visit: '初診', date1: ymd, time1: '午前',
      message: 'これはテスト送信です。\nインフルエンザの予防接種を希望します。', agree: '同意する',
    },
  });
  console.log(res.getContent());
}
