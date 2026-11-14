"use strict";

/*
 * 院内システム（Google スプレッドシート）から「お知らせ」「よくあるご質問」を読み込む。
 * 院内システムで「公開」にしたものだけが届く。
 * 読み込めなかったとき（通信の不調など）は null を返し、各ページはもとの内容をそのまま表示する。
 *
 * 読み出し口は、ご予約フォームの送信先（js/reservation.js の GAS_URL）と同じ Apps Script。
 */
window.SatoCms = (() => {
  const API_URL = "https://script.google.com/macros/s/AKfycbxwOKruMLG-Qd4bP6sU1QNN88eOB7Vz093VBSjbkHxBUjOITmwL66hvKXsH8ppmaQSc/exec";
  const TIMEOUT_MS = 10000;

  async function load(type) {
    if (!API_URL || !window.fetch) return null;
    const controller = window.AbortController ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
    try {
      const response = await fetch(`${API_URL}?type=${encodeURIComponent(type)}`, { signal: controller && controller.signal });
      const data = await response.json();
      return data && data.ok && Array.isArray(data.items) ? data : null;
    } catch (error) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // 「[文字](ページ名)」をリンクにして、1行を1つの段落（<p>）にする
  function paragraphs(lines) {
    return (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map(line => {
      const p = document.createElement("p");
      const pattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
      let last = 0;
      let match;
      while ((match = pattern.exec(line))) {
        p.append(line.slice(last, match.index));
        const url = match[2];
        const safe = /^(https:\/\/|tel:|mailto:|#)/.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url);
        if (safe) {
          const a = document.createElement("a");
          a.href = url;
          a.textContent = match[1];
          p.append(a);
        } else {
          p.append(match[0]);
        }
        last = pattern.lastIndex;
      }
      p.append(line.slice(last));
      return p;
    });
  }

  // URL の #news-1 などの場所へ移動する
  function scrollToHash() {
    if (!location.hash) return false;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView();
    return Boolean(target);
  }

  return { load, paragraphs, scrollToHash };
})();
