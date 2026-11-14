/**
 * 佐藤医院 院内システム（Google Apps Script）
 *
 * できること：
 *   ・ご相談（Webフォームから届いた受付）の一覧・対応状況・メモ
 *   ・お知らせの追加・編集・並べ替え・公開／非公開
 *   ・よくあるご質問の追加・編集・並べ替え・公開／非公開・トップページに出すかどうか
 *
 * データはすべて、Webフォームと同じスプレッドシート「佐藤医院 ご予約・ご相談 受付一覧」に入っています。
 *   ・シート「受付一覧」……Webフォームから届いたご相談（フォーム側の Code.gs が書き込む）
 *   ・シート「お知らせ」……公開サイトの「お知らせ」
 *   ・シート「よくあるご質問」……公開サイトの「よくあるご質問」
 *
 * 公開サイトは、フォーム側の Code.gs（doGet）を通して「公開」の行だけを読みます。
 * このプロジェクトは「自分のみ」がアクセスできるウェブアプリとして公開してください。
 *
 * 初回だけ：setupCms を実行 → 「デプロイ」→「ウェブアプリ」（次のユーザーとして実行：自分／アクセスできるユーザー：自分のみ）。
 */

const CMS = {
  // Webフォームが作ったスプレッドシートの ID（URL の /d/ と /edit の間）
  SPREADSHEET_ID: '1VzX1V6KCbPMUm9Bad5F2D1DA5DxUNMTtX-36LPnniXc',
  SITE_URL: 'https://kazu1012.github.io/sato-clinic/site/',
  ACCOUNT: 'sato.clinic.test2026@gmail.com', // Gmail で返信するときに使うアカウント
  TIMEZONE: 'Asia/Tokyo',
  SHEET_INQUIRY: '受付一覧',
  SHEET_NEWS: 'お知らせ',
  SHEET_FAQ: 'よくあるご質問',
  TOP_FAQ_MAX: 5, // トップページに出す「よくあるご質問」の最大件数
};

const STATUS_PUBLIC = '公開';
const STATUS_PRIVATE = '非公開';
const INQUIRY_STATUSES = ['未対応', '対応中', '完了'];
const FAQ_CATEGORIES = ['診療について', '予防接種・健康診断について', 'お支払いについて', 'その他'];

const NEWS_HEADERS = ['ID', '状態', '掲載日', 'タイトル', '本文', '並び順', '更新日時'];
const FAQ_HEADERS = ['ID', '状態', '分類', '質問', '回答', 'トップに表示', '並び順', '更新日時'];

/* ================= 画面 ================= */

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('佐藤医院 院内システム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 画面の最初に渡す設定
function getConfig() {
  return {
    siteUrl: CMS.SITE_URL,
    account: CMS.ACCOUNT,
    sheetUrl: ss_().getUrl(),
    categories: FAQ_CATEGORIES,
    inquiryStatuses: INQUIRY_STATUSES,
    topFaqMax: CMS.TOP_FAQ_MAX,
  };
}

/* ================= ご相談 ================= */

function getInquiries() {
  const sheet = ss_().getSheetByName(CMS.SHEET_INQUIRY);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const head = values[0].map(String);
  const col = (name) => head.indexOf(name);
  const pick = (row, name) => (col(name) >= 0 ? row[col(name)] : '');
  return values.slice(1)
    .filter((row) => String(pick(row, '受付番号')).trim())
    .map((row) => ({
      id: String(pick(row, '受付番号')),
      receivedAt: dateTimeText_(pick(row, '受付日時')),
      name: String(pick(row, 'お名前')),
      kana: String(pick(row, 'ふりがな')),
      tel: String(pick(row, '電話番号')).replace(/^'/, ''),
      email: String(pick(row, 'メールアドレス')),
      type: String(pick(row, 'ご希望の内容')),
      visit: String(pick(row, '初診・再診')),
      date1: dateText_(pick(row, '第1希望日')),
      time1: String(pick(row, '第1希望時間帯')),
      date2: dateText_(pick(row, '第2希望日')),
      time2: String(pick(row, '第2希望時間帯')),
      message: String(pick(row, 'ご相談内容')),
      status: INQUIRY_STATUSES.indexOf(String(pick(row, '対応状況'))) >= 0 ? String(pick(row, '対応状況')) : '未対応',
      memo: String(pick(row, 'メモ')),
    }))
    .reverse(); // 新しい順
}

function updateInquiry(id, changes) {
  return withLock_(() => {
    const sheet = ss_().getSheetByName(CMS.SHEET_INQUIRY);
    if (!sheet) throw new Error('受付一覧のシートが見つかりません。');
    const values = sheet.getDataRange().getValues();
    const head = values[0].map(String);
    const idCol = head.indexOf('受付番号');
    const r = values.findIndex((row, i) => i > 0 && String(row[idCol]) === String(id));
    if (r < 0) throw new Error('このご相談が見つかりません（' + id + '）。');
    if (changes.status != null) {
      if (INQUIRY_STATUSES.indexOf(changes.status) < 0) throw new Error('対応状況の値が正しくありません。');
      sheet.getRange(r + 1, head.indexOf('対応状況') + 1).setValue(changes.status);
    }
    if (changes.memo != null) {
      const memo = String(changes.memo).slice(0, 2000);
      sheet.getRange(r + 1, head.indexOf('メモ') + 1).setValue(safeCell_(memo));
    }
    return getInquiries().filter((x) => x.id === String(id))[0];
  });
}

/* ================= お知らせ ================= */

function getNews() {
  return readTable_(CMS.SHEET_NEWS, NEWS_HEADERS).map(newsFromRow_);
}

function saveNews(item) {
  return withLock_(() => {
    const title = oneLine_(item.title);
    const body = String(item.body || '').replace(/\r\n?/g, '\n').trim();
    const date = String(item.date || '').trim();
    const status = item.status === STATUS_PUBLIC ? STATUS_PUBLIC : STATUS_PRIVATE;
    if (!title) throw new Error('タイトルを入力してください。');
    if (title.length > 100) throw new Error('タイトルは100文字以内で入力してください。');
    if (!body) throw new Error('本文を入力してください。');
    if (body.length > 3000) throw new Error('本文は3000文字以内で入力してください。');
    if (date && !isYmd_(date)) throw new Error('掲載日の形が正しくありません。');
    const row = { ID: item.id || newId_('news'), 状態: status, 掲載日: date, タイトル: title, 本文: body };
    upsert_(CMS.SHEET_NEWS, NEWS_HEADERS, row);
    return getNews();
  });
}

function moveNews(id, direction) {
  return withLock_(() => { move_(CMS.SHEET_NEWS, NEWS_HEADERS, id, direction); return getNews(); });
}

function setNewsStatus(id, status) {
  return withLock_(() => { setStatus_(CMS.SHEET_NEWS, NEWS_HEADERS, id, status); return getNews(); });
}

/* ================= よくあるご質問 ================= */

function getFaq() {
  return readTable_(CMS.SHEET_FAQ, FAQ_HEADERS).map(faqFromRow_);
}

function saveFaq(item) {
  return withLock_(() => {
    const question = oneLine_(item.question);
    const answer = String(item.answer || '').replace(/\r\n?/g, '\n').trim();
    const category = String(item.category || '');
    const status = item.status === STATUS_PUBLIC ? STATUS_PUBLIC : STATUS_PRIVATE;
    if (FAQ_CATEGORIES.indexOf(category) < 0) throw new Error('分類を選んでください。');
    if (!question) throw new Error('質問を入力してください。');
    if (question.length > 200) throw new Error('質問は200文字以内で入力してください。');
    if (!answer) throw new Error('回答を入力してください。');
    if (answer.length > 2000) throw new Error('回答は2000文字以内で入力してください。');
    const row = {
      ID: item.id || newId_('faq'), 状態: status, 分類: category, 質問: question, 回答: answer,
      トップに表示: item.top ? 'はい' : '',
    };
    upsert_(CMS.SHEET_FAQ, FAQ_HEADERS, row);
    return getFaq();
  });
}

function moveFaq(id, direction) {
  return withLock_(() => { move_(CMS.SHEET_FAQ, FAQ_HEADERS, id, direction); return getFaq(); });
}

function setFaqStatus(id, status) {
  return withLock_(() => { setStatus_(CMS.SHEET_FAQ, FAQ_HEADERS, id, status); return getFaq(); });
}

/* ================= 表の読み書き（共通） ================= */

function newsFromRow_(r) {
  return {
    id: r.ID, status: r.状態 === STATUS_PUBLIC ? STATUS_PUBLIC : STATUS_PRIVATE,
    date: dateText_(r.掲載日), title: String(r.タイトル), body: String(r.本文),
    order: Number(r.並び順) || 0, updatedAt: dateTimeText_(r.更新日時),
  };
}

function faqFromRow_(r) {
  return {
    id: r.ID, status: r.状態 === STATUS_PUBLIC ? STATUS_PUBLIC : STATUS_PRIVATE,
    category: String(r.分類), question: String(r.質問), answer: String(r.回答),
    top: String(r.トップに表示) === 'はい', order: Number(r.並び順) || 0, updatedAt: dateTimeText_(r.更新日時),
  };
}

// 見出しの名前で読み、並び順の小さい順に返す
function readTable_(name, headers) {
  const sheet = sheet_(name, headers);
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getRange(1, 1, sheet.getLastRow(), headers.length).getValues();
  const head = values[0].map(String);
  return values.slice(1)
    .filter((row) => String(row[head.indexOf('ID')]).trim())
    .map((row) => {
      const o = {};
      headers.forEach((h) => { o[h] = row[head.indexOf(h)]; });
      o.ID = String(o.ID);
      return o;
    })
    .sort((a, b) => (Number(a.並び順) || 0) - (Number(b.並び順) || 0));
}

// ID が同じ行があれば上書き、なければ先頭（並び順がいちばん小さい）に追加
function upsert_(name, headers, row) {
  const sheet = sheet_(name, headers);
  const rows = readTable_(name, headers);
  const now = new Date();
  const existing = rows.filter((r) => r.ID === row.ID)[0];
  if (existing) {
    const r = findRow_(sheet, row.ID);
    headers.forEach((h, i) => {
      if (h in row) sheet.getRange(r, i + 1).setValue(safeCell_(row[h]));
    });
    sheet.getRange(r, headers.indexOf('更新日時') + 1).setValue(now);
  } else {
    const minOrder = rows.length ? Math.min.apply(null, rows.map((x) => Number(x.並び順) || 0)) : 1;
    const values = headers.map((h) => {
      if (h === '並び順') return minOrder - 1;
      if (h === '更新日時') return now;
      return h in row ? safeCell_(row[h]) : '';
    });
    sheet.appendRow(values);
  }
  renumber_(name, headers);
}

function move_(name, headers, id, direction) {
  const rows = readTable_(name, headers);
  const i = rows.findIndex((r) => r.ID === String(id));
  if (i < 0) throw new Error('対象が見つかりません。');
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= rows.length) return;
  const tmp = rows[i]; rows[i] = rows[j]; rows[j] = tmp;
  writeOrder_(name, headers, rows);
}

function setStatus_(name, headers, id, status) {
  if (status !== STATUS_PUBLIC && status !== STATUS_PRIVATE) throw new Error('状態の値が正しくありません。');
  const sheet = sheet_(name, headers);
  const r = findRow_(sheet, id);
  if (!r) throw new Error('対象が見つかりません。');
  sheet.getRange(r, headers.indexOf('状態') + 1).setValue(status);
  sheet.getRange(r, headers.indexOf('更新日時') + 1).setValue(new Date());
}

// 並び順を 1, 2, 3… に振り直す
function renumber_(name, headers) {
  writeOrder_(name, headers, readTable_(name, headers));
}

function writeOrder_(name, headers, rows) {
  const sheet = sheet_(name, headers);
  const col = headers.indexOf('並び順') + 1;
  rows.forEach((r, i) => {
    const row = findRow_(sheet, r.ID);
    if (row) sheet.getRange(row, col).setValue(i + 1);
  });
}

function findRow_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

/* ================= スプレッドシート ================= */

function ss_() {
  return SpreadsheetApp.openById(CMS.SPREADSHEET_ID);
}

// シートがなければ作る（見出し行つき）
function sheet_(name, headers) {
  const ss = ss_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#EEF5F3');
    sheet.setFrozenRows(1);
    // 掲載日・ID を文字として扱う（日付に自動変換させない）
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
    const u = headers.indexOf('更新日時');
    if (u >= 0) sheet.getRange(2, u + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy/MM/dd HH:mm');
    const o = headers.indexOf('並び順');
    if (o >= 0) sheet.getRange(2, o + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('0');
  }
  return sheet;
}

/* ================= 小さな道具 ================= */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function newId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), CMS.TIMEZONE, 'yyyyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
}

function isYmd_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const a = s.split('-').map(Number);
  const d = new Date(Date.UTC(a[0], a[1] - 1, a[2]));
  return d.toISOString().slice(0, 10) === s;
}

function dateText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CMS.TIMEZONE, 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

function dateTimeText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CMS.TIMEZONE, 'yyyy/MM/dd HH:mm');
  return String(v == null ? '' : v);
}

function oneLine_(s) {
  return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim();
}

// 「=」などで始まる文字を数式として実行させない
function safeCell_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

/* ================= 初回設定（エディタから1回だけ実行） ================= */

// シート「お知らせ」「よくあるご質問」を作り、今のサイトの内容を入れる（すでに行があれば何もしない）
function setupCms() {
  const now = new Date();
  const news = sheet_(CMS.SHEET_NEWS, NEWS_HEADERS);
  if (news.getLastRow() < 2) {
    SEED_NEWS.forEach((n, i) => news.appendRow([n.id, STATUS_PUBLIC, '', n.title, n.body, i + 1, now]));
  }
  const faq = sheet_(CMS.SHEET_FAQ, FAQ_HEADERS);
  if (faq.getLastRow() < 2) {
    SEED_FAQ.forEach((f, i) => faq.appendRow([f.id, STATUS_PUBLIC, f.category, f.question, f.answer, f.top ? 'はい' : '', i + 1, now]));
  }
  console.log('お知らせ：' + (news.getLastRow() - 1) + '件／よくあるご質問：' + (faq.getLastRow() - 1) + '件');
  console.log('スプレッドシート：' + ss_().getUrl());
}

// 掲載原稿どおりの初期データ（setupCms でだけ使う）
const SEED_NEWS = [
  { id: 'news-1', title: 'インフルエンザ予防接種について', body: '今年もインフルエンザの予防接種を開始いたしました。予約制となっておりますので、お電話または受付にてご予約をお願いいたします。例年、予約が集中しやすいため、早めのご予約をおすすめいたします。' },
  { id: 'news-2', title: '年末年始の休診について', body: '年末年始の休診日は、12月29日（火）〜1月4日（月）となります。年始は1月5日（火）より通常診療を再開いたします。皆様にはご不便をおかけしますが、何卒ご了承くださいますようお願いいたします。' },
  { id: 'news-3', title: '健康診断のご案内', body: '今年も健康診断を実施しております。定期的な健康チェックは、病気の早期発見・予防にとても重要です。各種健康診断メニューをご用意しておりますので、ご希望の方はお電話にてお申し込みください。' },
  { id: 'news-4', title: '新型コロナウイルス対策について', body: '当院では引き続き、新型コロナウイルス感染症対策を徹底しております。ご来院の際には、マスクの着用、手指消毒にご協力をお願いいたします。また、発熱や風邪症状のある方は、事前にお電話でご相談いただけるとスムーズにご案内が可能です。' },
  { id: 'news-5', title: 'オンライン診療の導入について', body: '2024年より、オンライン診療を一部導入いたしました。通院が難しい方や、遠方にお住まいの方にご利用いただけます。ご希望の方は、当院スタッフまでお問い合わせください。' },
];

const SEED_FAQ = [
  { id: 'faq-reservation', category: '診療について', top: true, question: '診療は予約制ですか？', answer: '一般診療は予約なしでも受け付けていますが、予約優先制となっております。予防接種や健康診断などは完全予約制です。お電話または[Web予約](reservation.html)をご利用ください。' },
  { id: 'faq-first-visit', category: '診療について', top: true, question: '初診時に必要なものは何ですか？', answer: '健康保険証、お薬手帳（お持ちの方）、診療情報提供書（紹介状）があればご持参ください。また、問診票を事前にご記入いただけると受付がスムーズです。' },
  { id: 'faq-time', category: '診療について', top: false, question: '診察にはどれくらい時間がかかりますか？', answer: '症状や混雑状況によりますが、目安として30分〜1時間程度です。事前に混雑状況をお問い合わせいただくことをお勧めします。' },
  { id: 'faq-flu', category: '予防接種・健康診断について', top: false, question: 'インフルエンザの予防接種はいつから受けられますか？', answer: '例年10月中旬頃から接種を開始します。予約受付は9月末から行っておりますので、詳しくは[お知らせ](news.html)をご確認ください。' },
  { id: 'faq-checkup', category: '予防接種・健康診断について', top: false, question: '健康診断はどのような内容がありますか？', answer: '一般的な健康診断から生活習慣病予防検診まで対応しております。採血、尿検査、心電図、胸部レントゲンなどが含まれます。詳しくはスタッフまでお問い合わせください。' },
  { id: 'faq-child-vaccine', category: '予防接種・健康診断について', top: true, question: '子どもの予防接種も対応していますか？', answer: '当院では、小児用の予防接種（例：MRワクチン、ヒブワクチンなど）も実施しております。スケジュールについてはお問い合わせください。' },
  { id: 'faq-card', category: 'お支払いについて', top: false, question: '支払いにクレジットカードは使えますか？', answer: 'はい、当院では現金、クレジットカード（一部カードを除く）、電子マネーに対応しております。詳しくは受付にてお尋ねください。' },
  { id: 'faq-receipt', category: 'お支払いについて', top: false, question: '医療費控除に必要な領収書を再発行してもらえますか？', answer: 'はい、再発行可能です。ただし、再発行には日数をいただく場合がありますのでご了承ください。' },
  { id: 'faq-parking', category: 'その他', top: true, question: '駐車場はありますか？', answer: 'はい、当院専用の無料駐車場が10台分ございます。満車の場合は近隣のコインパーキングをご利用ください。' },
  { id: 'faq-wheelchair', category: 'その他', top: true, question: '車椅子での利用は可能ですか？', answer: '可能です。エントランスはバリアフリー設計となっており、スロープもご用意しております。また、院内には車椅子で移動可能なスペースを確保しています。' },
  { id: 'faq-wifi', category: 'その他', top: false, question: '院内でWi-Fiは使えますか？', answer: 'はい、当院では無料Wi-Fiを提供しております。パスワードは受付でお知らせいたします。' },
];
