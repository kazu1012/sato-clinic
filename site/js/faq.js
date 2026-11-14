"use strict";

// よくあるご質問を、院内システム（js/cms.js）で「公開」にした内容に差し替える。
//   ・faq.html の [data-faq-archive] …… 分類ごとの一覧（質問と回答）
//   ・index.html の [data-faq-top] …… 「トップに表示」にした質問（最大5件）
// 読み込めなかったときは、HTML に書いてあるもとの内容のまま表示する。
(() => {
  const archive = document.querySelector("[data-faq-archive]");
  const top = document.querySelector("[data-faq-top]");
  if (!archive && !top) return;
  const foundAtFirst = window.SatoCms.scrollToHash();

  function mark(kind) {
    const span = document.createElement("span");
    span.className = `qa-mark qa-mark--${kind}`;
    span.setAttribute("aria-hidden", "true");
    span.textContent = kind === "q" ? "Q" : "A";
    return span;
  }

  function renderArchive(items, categories) {
    const sections = categories.map((category, index) => {
      const list = items.filter(item => item.category === category);
      if (!list.length) return null;
      const section = document.createElement("section");
      section.className = "faq-category";
      section.setAttribute("aria-labelledby", `faq-cat-${index + 1}`);
      const heading = document.createElement("h2");
      heading.id = `faq-cat-${index + 1}`;
      heading.textContent = category;
      const wrap = document.createElement("div");
      wrap.className = "faq-items";
      wrap.append(...list.map(item => {
        const box = document.createElement("div");
        box.className = "faq-item";
        box.id = item.id;
        const q = document.createElement("div");
        q.className = "faq-q";
        const h3 = document.createElement("h3");
        h3.textContent = item.question;
        q.append(mark("q"), h3);
        const a = document.createElement("div");
        a.className = "faq-a";
        a.append(mark("a"));
        const answer = window.SatoCms.paragraphs(item.answer);
        // もとの HTML と同じく、段落が1つなら <p> を直接置く
        if (answer.length === 1) a.append(answer[0]);
        else { const body = document.createElement("div"); body.append(...answer); a.append(body); }
        box.append(q, a);
        return box;
      }));
      section.append(heading, wrap);
      return section;
    }).filter(Boolean);
    archive.replaceChildren(...sections);
  }

  function renderTop(items) {
    const href = top.dataset.faqHref || "faq.html";
    const list = items.filter(item => item.top).slice(0, Number(top.dataset.faqLimit) || 5);
    top.replaceChildren(...list.map(item => {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.className = "faq-link";
      link.href = `${href}#${item.id}`;
      const markSpan = document.createElement("span");
      markSpan.className = "faq-mark";
      markSpan.setAttribute("aria-hidden", "true");
      markSpan.textContent = "Q";
      const text = document.createElement("span");
      text.textContent = item.question;
      link.append(markSpan, text);
      li.append(link);
      return li;
    }));
  }

  window.SatoCms.load("faq").then(data => {
    if (!data) return;
    const categories = Array.isArray(data.categories) ? data.categories : [];
    if (archive && data.items.length) renderArchive(data.items, categories);
    if (top && data.items.some(item => item.top)) renderTop(data.items);
    if (!foundAtFirst) window.SatoCms.scrollToHash();
  });
})();
