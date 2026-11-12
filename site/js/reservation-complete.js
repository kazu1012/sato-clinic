"use strict";

/*
 * 送信完了ページ（reservation-complete.html）
 * js/reservation.js から URL で渡された受付番号（?id=SATO-261112-0001）を表示します。
 * 決まった形の番号のときだけ表示するので、URL に別の文字を入れられても画面には出ません。
 */
(() => {
  const receipt = document.getElementById("complete-receipt");
  if (!receipt) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id") || "";
  const isDemo = id === "TEST-000000" && params.get("demo") === "1";
  if (!/^SATO-\d{6}-\d{4}$/.test(id) && !isDemo) return;

  document.getElementById("complete-receipt-id").textContent = id;
  receipt.hidden = false;
  document.getElementById("complete-demo-note").hidden = !isDemo;
})();
