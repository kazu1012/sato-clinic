"use strict";

// One navigation for all widths. Pending links deliberately have no href.
document.documentElement.classList.add("js");
const toggle = document.querySelector(".nav-toggle");
const navigation = document.querySelector("#primary-navigation");
const compactNavigation = window.matchMedia("(max-width: 73.75rem)");

function closeNavigation(returnFocus = false) {
  toggle.setAttribute("aria-expanded", "false");
  navigation.classList.remove("is-open");
  if (returnFocus) toggle.focus();
}

toggle.addEventListener("click", () => {
  const isOpen = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!isOpen));
  navigation.classList.toggle("is-open", !isOpen);
});

navigation.addEventListener("click", event => {
  const link = event.target.closest("a[href]");
  if (link && compactNavigation.matches) {
    // Move focus with the page jump before concealing the navigation.
    const target = document.querySelector(link.hash);
    if (target) {
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
    closeNavigation();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
    closeNavigation(true);
  }
});

document.addEventListener("click", event => {
  if (!event.target.closest(".site-header")) closeNavigation();
});

compactNavigation.addEventListener("change", () => closeNavigation());

// 2026-11-15：デスクトップでも .hero-copy を写真の上に表示するようにしたため、
// 電話リンクのフォーカス無効化（tabindex="-1"）は廃止。

// デスクトップのヒーロー：3枚の写真を順番に表示し、文字の位置を写真ごとに変える（2026-11-15）
(() => {
  const slides = document.querySelectorAll(".hero-slide");
  const copy = document.querySelector(".hero-copy");
  const dotsWrap = document.querySelector(".hero-dots");
  if (!slides.length || !copy || !dotsWrap) return;
  const INTERVAL = 8000;  // 1枚の表示時間（ミリ秒）
  const TEXT_FADE = 600;  // 文字が消えてから次の位置へ移るまで（ミリ秒）
  let current = 0, timer;

  slides.forEach((_, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `${i + 1}枚目の写真`);
    button.addEventListener("click", () => { show(i); start(); });
    dotsWrap.appendChild(button);
  });
  const dots = dotsWrap.querySelectorAll("button");
  const mark = () => dots.forEach((d, k) => k === current ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current"));

  function show(i) {
    if (i === current) return;
    slides[current].classList.remove("is-active");
    current = i;
    slides[current].classList.add("is-active");
    mark();
    if (compactNavigation.matches) {  // タブレット・スマホ：文字は写真の下なので動かさない
      copy.dataset.pos = slides[current].dataset.pos;
      return;
    }
    copy.classList.add("is-hidden");
    setTimeout(() => {
      copy.dataset.pos = slides[current].dataset.pos;
      copy.classList.remove("is-hidden");
    }, TEXT_FADE);
  }
  function start() {
    clearInterval(timer);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    timer = setInterval(() => show((current + 1) % slides.length), INTERVAL);
  }
  mark(); start();
  compactNavigation.addEventListener("change", start);
})();
