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

  // ---------- 日付まわり ----------
  const pad = (n) => String(n).padStart(2, '0');
  const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const today = new Date();
  const MIN_DATE = toYmd(addDays(today, 1));   // 明日から
  const MAX_DATE = toYmd(addDays(today, 90));  // 3か月先まで
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
  function checkDate(ymd, time) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '日付を選択してください。';
    const [y, m, d] = ymd.split('-').map(Number);
    if (new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) !== ymd) return '日付を選択してください。';
    if (ymd < MIN_DATE) return '明日以降の日付を選択してください。';
    if (ymd > MAX_DATE) return '3か月以内の日付を選択してください。';
    const w = weekday(ymd);
    if (w === 4) return '木曜日は休診日です。別の日を選択してください。';
    if (w === 0) return '日曜日は休診日です。別の日を選択してください。';
    if (w === 6 && time === '午後') return '土曜日の午後は休診です。午前を選択してください。';
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
      if (!/^[ぁ-ゖー\s　]+$/.test(s)) return 'ふりがなは、ひらがなで入力してください。';
      return '';
    },
    tel: (v) => {
      const digits = toHalfWidth(v).replace(/[^0-9]/g, '');
      if (!v.trim()) return '電話番号を入力してください。';
      if (!/^0\d{9,10}$/.test(digits)) return '電話番号は、0から始まる10〜11桁の数字で入力してください。';
      return '';
    },
    email: (v) => {
      const s = toHalfWidth(v.trim());
      if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'メールアドレスの形式が正しくありません。';
      return '';
    },
    type: (v) => (!v ? 'ご希望の内容を選択してください。' : ''),
    visit: (v) => (!v ? '初診・再診を選択してください。' : ''),
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
    agree: () => (!form.agree.checked ? '個人情報の取り扱いへの同意が必要です。' : ''),
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
    if (box) box.textContent = msg;
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
    const items = keys.map((k) => {
      const target = focusTargetOf(k);
      const id = target ? target.id : '';
      return `<li><a href="#${id}" data-key="${k}">${LABELS[k] || ''}：${escapeHtml(errors[k])}</a></li>`;
    }).join('');
    summary.innerHTML = `<p>入力内容をご確認ください（${keys.length}件）</p><ul>${items}</ul>`;
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

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
    if (key === 'message') updateCount();
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

  const counter = document.getElementById('message-count');
  function updateCount() { counter.textContent = `${form.message.value.length} / 1000文字`; }

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
    submitBtn.textContent = '送信中…';

    try {
      const body = new URLSearchParams(new FormData(form));
      let result;
      if (!GAS_URL) {
        // テスト表示：Googleに接続する前の見た目確認用
        await new Promise((r) => setTimeout(r, 600));
        result = { ok: true, id: 'TEST-000000', demo: true };
      } else {
        // Content-Typeを指定しない（＝単純なリクエスト）ことで、Apps Scriptに送れる
        const res = await fetch(GAS_URL, { method: 'POST', body });
        result = await res.json();
      }

      if (result && result.ok) {
        showComplete(result);
      } else if (result && result.errors) {
        Object.entries(result.errors).forEach(([k, msg]) => showError(k, msg));
        const known = Object.fromEntries(Object.entries(result.errors).filter(([k]) => RULES[k]));
        if (Object.keys(known).length) showSummary(known);
        else showFailure(result.errors._ || result.errors[Object.keys(result.errors)[0]]);
      } else {
        showFailure();
      }
    } catch (err) {
      console.error(err);
      showFailure();
    } finally {
      sending = false;
      submitBtn.disabled = false;
      submitBtn.textContent = '送信する';
    }
  });

  function showFailure(msg) {
    summary.innerHTML = `<p>${escapeHtml(msg || '送信できませんでした。')}</p>`
      + '<ul><li>時間をおいて、もう一度お試しください。</li><li>お急ぎの場合は、お電話（<a href="tel:0000000000">00-0000-0000</a>）でご連絡ください。</li></ul>';
    summary.hidden = false;
    summary.focus();
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
