/* 佐藤医院 ご予約・ご相談フォーム
 * 送信先：Google Apps Script（gas/Code.gs）を「ウェブアプリ」として公開したURL
 */

// ▼ Apps Scriptを公開したら、ここに「ウェブアプリのURL」（…/exec で終わる）を貼る
//   空のままだと「テスト表示」になり、実際には送信しません。
const GAS_URL = '';

(function () {
  'use strict';

  const form = document.getElementById('reserve-form');
  if (!form) return;

  const summary = document.getElementById('error-summary');
  const submitBtn = document.getElementById('submit-btn');
  const complete = document.getElementById('complete');

  // ---------- 改行の位置（文節の途中で切らない。js/reservation.js と同じしくみ） ----------
  const PHRASES = new Map();
  const P = (...parts) => { const text = parts.join(''); PHRASES.set(text, parts); return text; };
  function phrased(text) {
    const parts = PHRASES.get(text);
    if (!parts) return document.createTextNode(text);
    const span = document.createElement('span');
    span.className = 'phrased';
    parts.forEach((part, i) => { if (i) span.append(document.createElement('wbr')); span.append(part); });
    return span;
  }
  const MSG = {
    kana: P('ふりがなは', 'ひらがなで', '入力してください。'),
    tel: P('電話番号は、', '0から始まる', '10桁または11桁の', '数字で', '入力してください。'),
    visit: P('初診または', '再診を', '選択してください。'),
    badDate: P('正しい', '日付を', '入力してください。'),
    past: P('過去の', '日付は', '選択できません。'),
    closed: P('本日の', '予約受付は', '11:00に', '終了しました。', '別の日を', '選択してください。'),
    pmOnly: P('当日の', 'ご予約は', '午後のみ', '受け付けています。'),
    agree: P('個人情報の', '取り扱いに', '同意してください。'),
    offline: P('送信できませんでした。'),
    busy: P('現在、', '送信が', '混み合っています。'),
    gasError: P('送信処理で', 'エラーが', '発生しました。'),
    retry: P('時間をおいて、', 'もう一度', 'お試しください。'),
  };
  const SENDING = ['送信中です。', 'しばらくお待ちください。'];

  // ---------- 日付まわり（「今日」と「今の時刻」は日本時間で判定する） ----------
  const SAME_DAY_CLOSE = '11:00'; // 当日の予約受付の締め切り（Code.gs の CONFIG.SAME_DAY_CLOSE と同じ）
  const tokyoFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  function tokyoNow() {
    const p = {};
    tokyoFormat.formatToParts(new Date()).forEach(({ type, value }) => { p[type] = value; });
    return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
  }
  const addDaysYmd = (ymd, n) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const TODAY = tokyoNow().ymd;
  const MIN_DATE = TODAY;                  // 今日から（当日は午後のみ・11:00まで）
  const MAX_DATE = addDaysYmd(TODAY, 90);  // 3か月先まで
  ['date1', 'date2'].forEach((id) => {
    form[id].min = MIN_DATE;
    form[id].max = MAX_DATE;
  });

  // 'YYYY-MM-DD' の曜日（0=日〜6=土）。タイムゾーンの影響を受けないようUTCで計算
  function weekday(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  // 希望日のチェック（Code.gs の checkDate_ と同じルール）
  // 当日の判定の順：過去の日付 → 11:00を過ぎている → 当日の午前
  function checkDate(ymd, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return MSG.badDate;
    const [y, m, d] = ymd.split('-').map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== ymd) return MSG.badDate;
    const now = tokyoNow();
    if (ymd < now.ymd) return MSG.past;
    const isToday = ymd === now.ymd;
    if (isToday && now.hm >= SAME_DAY_CLOSE) return MSG.closed;
    if (ymd > MAX_DATE) return '3か月以内の日付を選択してください。';
    const w = weekday(ymd);
    if (w === 4) return '木曜日は休診日です。別の日を選択してください。';
    if (w === 0) return '日曜日は休診日です。別の日を選択してください。';
    if (w === 6 && time === '午後') return '土曜日の午後は休診です。午前を選択してください。';
    if (isToday && time === '午前') return MSG.pmOnly;
    return '';
  }

  // 土曜日を選んだら「午後」を選べないようにする
  function syncTimeOptions(dateId, timeId) {
    const sel = form[timeId];
    const pm = Array.from(sel.options).find((o) => o.value === '午後');
    const isSat = form[dateId].value && weekday(form[dateId].value) === 6;
    pm.disabled = isSat;
    pm.textContent = isSat ? '午後（土曜は休診）' : '午後';
    if (isSat && sel.value === '午後') sel.value = '';
    updateSelectColor(sel);
  }

  // ---------- 入力の整え ----------
  const toHalfWidth = (s) => s.replace(/[０-９Ａ-Ｚａ-ｚ＠．－＿＋]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

  form.kana.addEventListener('blur', () => { form.kana.value = kataToHira(form.kana.value.trim()); });
  form.tel.addEventListener('blur', () => {
    form.tel.value = toHalfWidth(form.tel.value.trim()).replace(/[ー−‐―－]/g, '-').replace(/\s/g, '');
  });
  form.email.addEventListener('blur', () => { form.email.value = toHalfWidth(form.email.value.trim()); });

  // ---------- 入力チェック（Code.gs の validate_ と同じルール） ----------
  const RULES = {
    name: (v) => (!v.trim() ? 'お名前を入力してください。' : ''),
    kana: (v) => {
      const s = kataToHira(v.trim());
      if (!s) return 'ふりがなを入力してください。';
      if (!/^[ぁ-ゖー\s　]+$/.test(s)) return MSG.kana;
      return '';
    },
    tel: (v) => {
      const digits = toHalfWidth(v).replace(/[^0-9]/g, '');
      if (!v.trim()) return '電話番号を入力してください。';
      if (!/^0\d{9,10}$/.test(digits)) return MSG.tel;
      return '';
    },
    email: (v) => {
      const s = toHalfWidth(v.trim());
      if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'メールアドレスの形式が正しくありません。';
      return '';
    },
    type: (v) => (!v ? 'ご希望の内容を選択してください。' : ''),
    visit: (v) => (!v ? MSG.visit : ''),
    date1: () => {
      if (!form.date1.value) return '第1希望の日付を選択してください。';
      const e = checkDate(form.date1.value, form.time1.value);
      if (e) return e;
      if (!form.time1.value) return '第1希望の時間帯（午前／午後）を選択してください。';
      return '';
    },
    date2: () => {
      const d = form.date2.value, t = form.time2.value;
      if (!d && !t) return '';
      if (!d) return '第2希望の日付を選択してください。';
      const e = checkDate(d, t);
      if (e) return e;
      if (!t) return '第2希望の時間帯（午前／午後）を選択してください。';
      if (d === form.date1.value && t === form.time1.value) return '第1希望と別の日時を選択してください。';
      return '';
    },
    message: (v) => (v.length > 1000 ? 'ご相談内容は1000文字以内で入力してください。' : ''),
    agree: () => (!form.agree.checked ? MSG.agree : ''),
  };
  const LABELS = {
    name: 'お名前', kana: 'ふりがな', tel: '電話番号', email: 'メールアドレス', type: 'ご希望の内容',
    visit: '初診・再診', date1: 'ご希望日（第1希望）', date2: 'ご希望日（第2希望）', message: 'ご相談内容', agree: '個人情報の取り扱い',
  };
  // エラー時に印を付ける入力欄
  const TARGETS = { date1: ['date1', 'time1'], date2: ['date2', 'time2'], visit: [] };

  function valueOf(key) {
    if (key === 'visit') { const r = form.querySelector('input[name=visit]:checked'); return r ? r.value : ''; }
    const el = form[key];
    return el && 'value' in el ? el.value : '';
  }

  function showError(key, msg) {
    const box = document.getElementById(`${key}-error`);
    if (box) box.replaceChildren(...(msg ? [phrased(msg)] : []));
    (TARGETS[key] || [key]).forEach((id) => {
      const el = form[id];
      if (!el) return;
      if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
    });
  }

  function validateField(key) {
    const msg = RULES[key](valueOf(key));
    showError(key, msg);
    return msg;
  }

  function validateAll() {
    const errors = {};
    Object.keys(RULES).forEach((key) => {
      const msg = validateField(key);
      if (msg) errors[key] = msg;
    });
    return errors;
  }

  function focusTargetOf(key) {
    if (key === 'visit') return form.querySelector('input[name=visit]');
    return form[(TARGETS[key] || [key])[0]];
  }

  function showSummary(errors) {
    const keys = Object.keys(errors);
    if (!keys.length) { summary.hidden = true; summary.innerHTML = ''; return; }
    const heading = document.createElement('p');
    heading.textContent = `入力内容をご確認ください（${keys.length}件）`;
    const list = document.createElement('ul');
    keys.forEach((k) => {
      const target = focusTargetOf(k);
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${target ? target.id : ''}`;
      a.dataset.key = k;
      a.append(`${LABELS[k] || ''}：`, phrased(errors[k]));
      li.append(a);
      list.append(li);
    });
    summary.replaceChildren(heading, list);
    summary.hidden = false;
    summary.focus();
  }
  summary.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[data-key]');
    if (!a) return;
    ev.preventDefault();
    const el = focusTargetOf(a.dataset.key);
    if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); }
  });

  // 入力し終えた欄だけをその場でチェック（入力途中で赤くしない）
  const touched = new Set();
  const keyOf = (id) => ({ time1: 'date1', time2: 'date2' }[id] || id);
  form.addEventListener('focusout', (ev) => {
    const id = ev.target.name || ev.target.id;
    if (!id || !RULES[keyOf(id)]) return;
    // 日付と時間帯は、両方に触れてからチェック（日付の誤りは change で知らせる）
    if (/^(date|time)[12]$/.test(id)) {
      touched.add(id);
      const n = id.slice(-1);
      if (!(touched.has(`date${n}`) && touched.has(`time${n}`))) return;
    }
    touched.add(keyOf(id));
    validateField(keyOf(id));
  });
  form.addEventListener('input', (ev) => {
    const key = keyOf(ev.target.name || ev.target.id);
    // すでにエラー表示中の欄は、直ったらすぐ消す
    const box = document.getElementById(`${key}-error`);
    if (box && box.textContent) validateField(key);
  });
  form.addEventListener('change', (ev) => {
    const id = ev.target.id;
    if (id === 'date1') syncTimeOptions('date1', 'time1');
    if (id === 'date2') syncTimeOptions('date2', 'time2');
    if (ev.target.tagName === 'SELECT') updateSelectColor(ev.target);
    // 日付を選んだ時点では、休診日などの「日付の誤り」だけを知らせる
    // （時間帯をまだ選んでいないことは、時間帯の欄に触れてから知らせる）
    if (/^date[12]$/.test(id)) {
      const n = id.slice(-1);
      const msg = form[id].value ? checkDate(form[id].value, form[`time${n}`].value) : '';
      if (msg || touched.has(`time${n}`)) validateField(`date${n}`);
      else showError(`date${n}`, '');
      return;
    }
    const key = keyOf(ev.target.name || id);
    if (RULES[key] && touched.has(key)) validateField(key);
  });

  function updateSelectColor(sel) { sel.classList.toggle('is-empty', !sel.value); }
  form.querySelectorAll('select').forEach(updateSelectColor);


  // ---------- メニュー（スマートフォン） ----------
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.getElementById('global-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    });
  }

  // ---------- 送信 ----------
  let sending = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (sending) return;

    // 送信直前に整える
    form.kana.value = kataToHira(form.kana.value.trim());
    form.tel.value = toHalfWidth(form.tel.value.trim()).replace(/[ー−‐―－]/g, '-').replace(/\s/g, '');
    form.email.value = toHalfWidth(form.email.value.trim());

    const errors = validateAll();
    if (Object.keys(errors).length) { showSummary(errors); return; }
    showSummary({});

    sending = true;
    submitBtn.disabled = true;
    submitBtn.classList.add('is-sending');
    submitBtn.replaceChildren(...SENDING.map((line) => {
      const span = document.createElement('span');
      span.textContent = line;
      return span;
    }));

    try {
      const body = new URLSearchParams(new FormData(form));
      let result;
      if (!GAS_URL) {
        // テスト表示：Googleに接続する前の見た目確認用
        await new Promise((r) => setTimeout(r, 600));
        result = { ok: true, id: 'TEST-000000', demo: true };
      } else {
        // Content-Typeを指定しない（＝単純なリクエスト）ことで、Apps Scriptに送れる
        const res = await fetch(GAS_URL, { method: 'POST', body }); // 届かなければ catch へ（通信の不具合）
        result = await res.json().catch(() => null);               // 返事が読めなければ null（GAS の不具合）
      }

      if (result && result.ok) {
        showComplete(result);
      } else if (result && result.errors) {
        Object.entries(result.errors).forEach(([k, msg]) => showError(k, msg));
        const known = Object.fromEntries(Object.entries(result.errors).filter(([k]) => RULES[k]));
        if (Object.keys(known).length) showSummary(known);
        else showServerFailure(result.errors._ || result.errors[Object.keys(result.errors)[0]]);
      } else {
        showServerFailure();
      }
    } catch (err) {
      console.error(err);
      showFailure(MSG.offline, false);
    } finally {
      sending = false;
      submitBtn.disabled = false;
      submitBtn.classList.remove('is-sending');
      submitBtn.textContent = '送信する';
    }
  });

  // 送信できなかったとき：通信の不具合は1行だけ、混雑・GASの不具合は3行（電話番号はリンク）
  function showFailure(msg, withHelp) {
    const heading = document.createElement('p');
    heading.append(phrased(msg));
    summary.replaceChildren(heading);
    if (withHelp) {
      const list = document.createElement('ul');
      const retry = document.createElement('li');
      retry.append(phrased(MSG.retry));
      const tel = document.createElement('li');
      const link = document.createElement('a');
      link.href = 'tel:0000000000';
      link.className = 'nowrap';
      link.textContent = '00-0000-0000';
      const line = document.createElement('span');
      line.className = 'phrased';
      line.append('お急ぎの', document.createElement('wbr'), '場合は、', document.createElement('wbr'),
        'お電話（', link, '）で', document.createElement('wbr'), 'ご連絡ください。');
      tel.append(line);
      list.append(retry, tel);
      summary.append(list);
    }
    summary.hidden = false;
    summary.focus();
  }
  // Code.gs からの「_」の文言は、最初の1文を1行目にする
  function showServerFailure(msg) {
    const first = (String(msg || '').match(/^[^。]*。/) || [''])[0];
    showFailure(first || MSG.gasError, true);
  }

  function showComplete(result) {
    document.getElementById('receipt-id').textContent = result.id || '';
    document.getElementById('demo-note').hidden = !result.demo;
    form.hidden = true;
    summary.hidden = true;
    complete.hidden = false;
    complete.focus();
    complete.scrollIntoView({ block: 'center' });
  }
})();
