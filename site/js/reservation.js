"use strict";

/*
 * ご予約・ご相談フォーム（reservation.html）
 * 入力チェックをして、Google Apps Script（sato-contact/gas/Code.gs）に送信します。
 * 送信に成功したら reservation-complete.html に移り、受付番号を表示します。
 *
 * 入力のルールは Code.gs の validate_ / checkDate_ と同じです。片方を変えたら、もう片方も直してください。
 * ただし「メールアドレス（確認用）」の欄は画面だけのチェックで、Code.gs には送りません（name 属性を付けていないため）。
 * もとにしたファイル：sato-contact/contact.js
 */

// ▼ Apps Script を公開したら、ここに「ウェブアプリの URL」（…/exec で終わる）を貼る
//   空のままだと「テスト表示」になり、実際には送信しません。
const GAS_URL = "https://script.google.com/macros/s/AKfycbxwOKruMLG-Qd4bP6sU1QNN88eOB7Vz093VBSjbkHxBUjOITmwL66hvKXsH8ppmaQSc/exec";

(() => {
  const form = document.getElementById("reservation-form");
  if (!form) return;

  // JavaScript が動くときは、ブラウザ標準のチェックの代わりにこのファイルのチェックを使う
  form.noValidate = true;

  const summary = document.getElementById("f-error-summary");
  const submitButton = form.querySelector(".submit-button");
  const submitLabel = submitButton.textContent;
  const COMPLETE_PAGE = "reservation-complete.html";

  // 入力欄（name 属性）→ 画面の id（email2 は確認用。name 属性がなく、送信しない）
  const IDS = {
    name: "f-name", kana: "f-kana", tel: "f-tel", email: "f-mail", email2: "f-mail2", type: "f-type",
    visit: "f-visit1", date1: "f-date1", time1: "f-time1", date2: "f-date2", time2: "f-time2",
    message: "f-message", agree: "f-agree",
  };
  // ---------- 改行の位置（文節の途中で切らない） ----------
  // P("ふりがなは", "ひらがなで", …) は、つないだ文字列を返し、文節の区切りを覚えておく。
  // 画面に出すときは、文節の間にだけ <wbr> を入れ、CSS（.phrased：word-break: keep-all）で文節の途中の改行を止める。
  // Code.gs から届いた同じ文言にも、同じ区切りが使われる。区切りを登録していない文言は、そのまま表示する。
  const PHRASES = new Map();
  const P = (...parts) => { const text = parts.join(""); PHRASES.set(text, parts); return text; };
  function phrased(text) {
    const parts = PHRASES.get(text);
    if (!parts) return document.createTextNode(text);
    const span = document.createElement("span");
    span.className = "phrased";
    parts.forEach((part, i) => {
      if (i) span.append(document.createElement("wbr"));
      span.append(part);
    });
    return span;
  }

  // 今回の変更で直した文言・新しく出す文言（文節で区切る）
  const MSG = {
    kana: P("ふりがなは", "ひらがなで", "入力してください。"),
    tel: P("電話番号は、", "0から始まる", "10桁または11桁の", "数字で", "入力してください。"),
    visit: P("初診または", "再診を", "選択してください。"),
    badDate: P("正しい", "日付を", "入力してください。"),
    past: P("過去の", "日付は", "選択できません。"),
    closed: P("本日の", "予約受付は", "11:00に", "終了しました。", "別の日を", "選択してください。"),
    pmOnly: P("当日の", "ご予約は", "午後のみ", "受け付けています。"),
    satToday: P("土曜日は", "午後が", "休診のため、", "当日の", "ご予約は", "受け付けておりません。", "別の日を", "選択してください。"),
    agree: P("個人情報の", "取り扱いに", "同意してください。"),
    offline: P("送信できませんでした。"),
    busy: P("現在、", "送信が", "混み合っています。"),
    gasError: P("送信処理で", "エラーが", "発生しました。"),
    retry: P("時間をおいて、", "もう一度", "お試しください。"),
  };
  const SENDING = ["送信中です。", "しばらくお待ちください。"]; // ボタン：2行になるときは「。」の後ろで改行

  const el = (name) => document.getElementById(IDS[name]);
  const value = (name) => {
    if (name === "visit") {
      const checked = form.querySelector("input[name=visit]:checked");
      return checked ? checked.value : "";
    }
    return el(name).value;
  };

  // ---------- 日付まわり（「今日」と「今の時刻」は日本時間で判定する） ----------
  const SAME_DAY_CLOSE = "11:00"; // 当日の予約受付の締め切り（Code.gs の CONFIG.SAME_DAY_CLOSE と同じ）
  const tokyoFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  // 日本時間の今：{ ymd: 'YYYY-MM-DD', hm: 'HH:mm' }
  function tokyoNow() {
    const p = {};
    tokyoFormat.formatToParts(new Date()).forEach(({ type, value: v }) => { p[type] = v; });
    return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
  }
  const addDaysYmd = (ymd, n) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const TODAY = tokyoNow().ymd;
  const MIN_DATE = TODAY;                  // 今日から（当日は午後のみ・11:00まで）
  const MAX_DATE = addDaysYmd(TODAY, 90);  // 3か月先まで
  ["date1", "date2"].forEach((name) => {
    el(name).min = MIN_DATE;
    el(name).max = MAX_DATE;
  });

  // 'YYYY-MM-DD' の曜日（0=日〜6=土）。タイムゾーンの影響を受けないよう UTC で計算
  function weekday(ymd) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  // 希望日のチェック（Code.gs の checkDate_ と同じルール）
  // 当日の判定の順：過去の日付 → 当日が土曜日 → 11:00を過ぎている → 当日の午前
  // 「今」はチェックのたびに取り直す（ページを開いたまま11:00や日付をまたいでも正しく判定する）
  function checkDate(ymd, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return MSG.badDate;
    const [y, m, d] = ymd.split("-").map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== ymd) return MSG.badDate;
    const now = tokyoNow();
    if (ymd < now.ymd) return MSG.past;
    const isToday = ymd === now.ymd;
    if (isToday && weekday(ymd) === 6) return MSG.satToday; // 当日が土曜日：時刻や時間帯にかかわらず受け付けない
    if (isToday && now.hm >= SAME_DAY_CLOSE) return MSG.closed;
    if (ymd > MAX_DATE) return "3か月以内の日付を選択してください。";
    const w = weekday(ymd);
    if (w === 4) return "木曜日は休診日です。別の日を選択してください。";
    if (w === 0) return "日曜日は休診日です。別の日を選択してください。";
    if (w === 6 && time === "午後") return "土曜日の午後は休診です。午前を選択してください。";
    if (isToday && time === "午前") return MSG.pmOnly;
    return "";
  }

  // 土曜日を選んだら「午後」を選べないようにする
  function syncTimeOptions(n) {
    const select = el(`time${n}`);
    const pm = Array.from(select.options).find((o) => o.value === "午後");
    const date = el(`date${n}`).value;
    const isSaturday = Boolean(date) && weekday(date) === 6;
    pm.disabled = isSaturday;
    pm.textContent = isSaturday ? "午後（土曜は休診）" : "午後";
    if (isSaturday && select.value === "午後") select.value = "";
  }

  // ---------- 入力の整え ----------
  const toHalfWidth = (s) => s.replace(/[０-９Ａ-Ｚａ-ｚ＠．－＿＋]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const normalizeTel = (s) => toHalfWidth(s.trim()).replace(/[ー−‐―－]/g, "-").replace(/\s/g, "");

  const NORMALIZE = {
    kana: (s) => kataToHira(s.trim()),
    tel: normalizeTel,
    email: (s) => toHalfWidth(s.trim()),
    email2: (s) => toHalfWidth(s.trim()),
  };
  Object.keys(NORMALIZE).forEach((name) => {
    el(name).addEventListener("blur", () => { el(name).value = NORMALIZE[name](el(name).value); });
  });

  // ---------- 入力チェック（Code.gs の validate_ と同じルール） ----------
  const RULES = {
    name: (v) => {
      const s = v.trim();
      if (!s) return "お名前を入力してください。";
      if (s.length > 50) return "お名前は50文字以内で入力してください。";
      return "";
    },
    kana: (v) => {
      const s = kataToHira(v.trim());
      if (!s) return "ふりがなを入力してください。";
      if (!/^[ぁ-ゖー\s　]+$/.test(s)) return MSG.kana;
      if (s.length > 50) return "ふりがなは50文字以内で入力してください。";
      return "";
    },
    tel: (v) => {
      const s = normalizeTel(v);
      if (!s) return "電話番号を入力してください。";
      if (!/^0\d{9,10}$/.test(s.replace(/[^0-9]/g, "")) || !/^[0-9\-()]+$/.test(s)) {
        return MSG.tel;
      }
      return "";
    },
    email: (v) => {
      const s = toHalfWidth(v.trim());
      if (s && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 254)) return "メールアドレスの形式が正しくありません。";
      return "";
    },
    // 確認用（画面だけのチェック）：整えたあとで、大文字・小文字を区別せずに比べる
    email2: (v) => {
      const mail = toHalfWidth(value("email").trim());
      const s = toHalfWidth(v.trim());
      if (!mail && !s) return "";
      if (!s) return "確認のため、メールアドレスをもう一度入力してください。";
      if (s.toLowerCase() !== mail.toLowerCase()) return "メールアドレスが一致しません。";
      return "";
    },
    type: (v) => (!v ? "ご希望の内容を選択してください。" : ""),
    visit: (v) => (!v ? MSG.visit : ""),
    date1: () => {
      const d = value("date1"), t = value("time1");
      if (!d) return "第1希望の日付を選択してください。";
      const e = checkDate(d, t);
      if (e) return e;
      if (!t) return "第1希望の時間帯（午前／午後）を選択してください。";
      return "";
    },
    date2: () => {
      const d = value("date2"), t = value("time2");
      if (!d && !t) return "";
      if (!d) return "第2希望の日付を選択してください。";
      const e = checkDate(d, t);
      if (e) return e;
      if (!t) return "第2希望の時間帯（午前／午後）を選択してください。";
      if (d === value("date1") && t === value("time1")) return "第1希望と別の日時を選択してください。";
      return "";
    },
    message: (v) => (v.replace(/\r\n?/g, "\n").trim().length > 1000 ? "ご相談内容は1000文字以内で入力してください。" : ""),
    agree: () => (!el("agree").checked ? MSG.agree : ""),
  };
  const LABELS = {
    name: "お名前", kana: "ふりがな", tel: "電話番号", email: "メールアドレス", email2: "メールアドレス（確認用）", type: "ご希望の内容",
    visit: "初診・再診", date1: "ご希望日（第1希望）", date2: "ご希望日（第2希望）", message: "ご相談内容", agree: "個人情報の取り扱い",
  };
  // エラーのとき aria-invalid を付ける入力欄
  const TARGETS = {
    visit: () => Array.from(form.querySelectorAll("input[name=visit]")),
    date1: () => [el("date1"), el("time1")],
    date2: () => [el("date2"), el("time2")],
  };
  const targetsOf = (key) => (TARGETS[key] ? TARGETS[key]() : [el(key)]);

  function showError(key, message) {
    const box = document.getElementById(`f-${key}-error`);
    if (box) box.replaceChildren(...(message ? [phrased(message)] : [])); // 空のときは中身なし（CSS の :empty が効くように）
    targetsOf(key).forEach((input) => {
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    });
  }

  function validateField(key) {
    const message = RULES[key](value(key));
    showError(key, message);
    return message;
  }

  function validateAll() {
    const errors = {};
    Object.keys(RULES).forEach((key) => {
      const message = validateField(key);
      if (message) errors[key] = message;
    });
    return errors;
  }

  // エラー一覧（フォームの上）
  function showSummary(errors) {
    const keys = Object.keys(errors);
    summary.replaceChildren();
    if (!keys.length) { summary.hidden = true; return; }
    const heading = document.createElement("p");
    heading.textContent = `入力内容をご確認ください（${keys.length}件）`;
    const list = document.createElement("ul");
    keys.forEach((key) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${targetsOf(key)[0].id}`;
      link.dataset.key = key;
      link.append(`${LABELS[key]}：`, phrased(errors[key]));
      item.append(link);
      list.append(item);
    });
    summary.append(heading, list);
    summary.hidden = false;
    summary.focus();
  }

  summary.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-key]");
    if (!link) return;
    event.preventDefault();
    const target = targetsOf(link.dataset.key)[0];
    target.focus();
    target.scrollIntoView({ block: "center" });
  });

  // 送信できなかったとき（フォームの上の赤い枠）
  //   通信の不具合        → 「送信できませんでした。」の1行だけ
  //   混雑・GASの不具合   → 1行目＋「時間をおいて…」＋「お急ぎの場合は、お電話（電話のリンク）で…」の3行
  function showFailure(message, withHelp) {
    summary.replaceChildren();
    const heading = document.createElement("p");
    heading.append(phrased(message));
    summary.append(heading);
    if (withHelp) {
      const list = document.createElement("ul");
      const retry = document.createElement("li");
      retry.append(phrased(MSG.retry));
      const tel = document.createElement("li");
      const telLink = document.createElement("a");
      telLink.href = "tel:0000000000";
      telLink.className = "nowrap";
      telLink.textContent = "00-0000-0000";
      // 「お急ぎの／場合は、／お電話（00-0000-0000）で／ご連絡ください。」の文節で区切る
      const line = document.createElement("span");
      line.className = "phrased";
      line.append("お急ぎの", document.createElement("wbr"), "場合は、", document.createElement("wbr"),
        "お電話（", telLink, "）で", document.createElement("wbr"), "ご連絡ください。");
      tel.append(line);
      list.append(retry, tel);
      summary.append(list);
    }
    summary.hidden = false;
    summary.focus();
  }
  const showOffline = () => showFailure(MSG.offline, false);
  // Code.gs からの「_」の文言は、最初の1文（「現在、送信が混み合っています。」など）を1行目にする
  // （古い Code.gs が長い文言を返しても、2行目以降と重ならないように）
  const showServerFailure = (message) => {
    const first = (String(message || "").match(/^[^。]*。/) || [""])[0];
    showFailure(first || MSG.gasError, true);
  };

  // ---------- 入力し終えた欄だけをその場でチェック（入力途中で赤くしない） ----------
  const keyOf = (name) => ({ time1: "date1", time2: "date2" }[name] || name);
  // name 属性のない確認用の欄は、id から見分ける
  const nameOf = (target) => target.name || (target.id === IDS.email2 ? "email2" : "");
  const touched = new Set();
  // メールアドレスを書き換えたら、確認用に何か入っているとき、確認用もチェックし直す
  const recheckEmail2 = () => { if (el("email2").value) validateField("email2"); };

  form.addEventListener("focusout", (event) => {
    const name = nameOf(event.target);
    if (!name || !RULES[keyOf(name)]) return;
    // 日付と時間帯は、両方に触れてからチェック（日付の誤りは change で知らせる）
    if (/^(date|time)[12]$/.test(name)) {
      touched.add(name);
      const n = name.slice(-1);
      if (!(touched.has(`date${n}`) && touched.has(`time${n}`))) return;
    }
    touched.add(keyOf(name));
    validateField(keyOf(name));
    if (name === "email") recheckEmail2();
  });

  form.addEventListener("input", (event) => {
    const key = keyOf(nameOf(event.target));
    // すでにエラー表示中の欄は、直ったらすぐ消す
    const box = document.getElementById(`f-${key}-error`);
    if (box && box.textContent) validateField(key);
    // メールアドレスを直して確認用と一致したら、確認用のエラーもすぐ消す
    if (key === "email" && document.getElementById("f-email2-error").textContent) recheckEmail2();
  });

  form.addEventListener("change", (event) => {
    const name = event.target.name;
    // 日付を選んだ時点では、休診日などの「日付の誤り」だけを知らせる
    if (/^date[12]$/.test(name)) {
      const n = name.slice(-1);
      syncTimeOptions(n);
      const message = value(name) ? checkDate(value(name), value(`time${n}`)) : "";
      if (message || touched.has(`time${n}`)) validateField(name);
      else showError(name, "");
      return;
    }
    const key = keyOf(name);
    if (RULES[key] && touched.has(key)) validateField(key);
  });

  // ---------- 送信 ----------
  let sending = false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;

    // 送信直前に整える
    Object.keys(NORMALIZE).forEach((name) => { el(name).value = NORMALIZE[name](el(name).value); });

    const errors = validateAll();
    if (Object.keys(errors).length) { showSummary(errors); return; }
    showSummary({});

    sending = true;
    submitButton.disabled = true;
    submitButton.classList.add("is-sending");
    submitButton.replaceChildren(...SENDING.map((line) => {
      const span = document.createElement("span");
      span.textContent = line;
      return span;
    }));

    try {
      let result;
      if (!GAS_URL) {
        // テスト表示：Google に接続する前の見た目確認用
        await new Promise((resolve) => setTimeout(resolve, 600));
        result = { ok: true, id: "TEST-000000", demo: true };
      } else {
        // Content-Type を指定しない（＝単純なリクエスト）ことで、Apps Script に送れる
        const body = new URLSearchParams(new FormData(form));
        const response = await fetch(GAS_URL, { method: "POST", body }); // 届かなければ catch へ（通信の不具合）
        result = await response.json().catch(() => null);               // 返事が読めなければ null（GAS の不具合）
      }

      if (result && result.ok) {
        const params = new URLSearchParams({ id: result.id || "" });
        if (result.demo) params.set("demo", "1");
        window.location.assign(`${COMPLETE_PAGE}?${params}`);
        return; // 移動するまでボタンは押せないままにする
      }

      if (result && result.errors) {
        Object.entries(result.errors).forEach(([key, message]) => { if (RULES[key]) showError(key, message); });
        const known = Object.fromEntries(Object.entries(result.errors).filter(([key]) => RULES[key]));
        if (Object.keys(known).length) showSummary(known);
        else showServerFailure(result.errors._ || Object.values(result.errors)[0]);
      } else {
        showServerFailure(); // 返事は届いたが中身が正しくない（Apps Script 側の不具合）
      }
    } catch (error) {
      // 通信できなかった（Apps Script に届かない・返事が読めない）
      console.error(error);
      showOffline();
    }

    resetButton();
  });

  function resetButton() {
    sending = false;
    submitButton.disabled = false;
    submitButton.classList.remove("is-sending");
    submitButton.textContent = submitLabel;
  }

  // 完了ページからブラウザの「戻る」で戻ったとき、ボタンが「送信中です。…」のまま残らないようにする
  window.addEventListener("pageshow", (event) => { if (event.persisted) resetButton(); });
})();
