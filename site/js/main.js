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
