"use strict";

// お知らせを、トップページの一覧と「お知らせ」ページに表示する。
// まず js/news-data.js の内容で表示し、院内システム（js/cms.js）から読み込めたら、その内容に差し替える。
(() => {
  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
  }

  function createDate(item) {
    const label = formatDate(item.date);
    if (!label) return null;
    const time = document.createElement("time");
    time.dateTime = item.date;
    time.textContent = label;
    return time;
  }

  function render(items) {
    // トップページ：タイトルのみ（data-news-limit 件まで）
    document.querySelectorAll("[data-news-list]").forEach(list => {
      const limit = Number(list.dataset.newsLimit) || items.length;
      const href = list.dataset.newsHref || "news.html";
      list.replaceChildren(...items.slice(0, limit).map(item => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.className = "news-link";
        link.href = `${href}#${item.id}`;
        const time = createDate(item);
        if (time) {
          time.className = "news-link-date";
          link.append(time);
        }
        const title = document.createElement("span");
        title.textContent = item.title;
        link.append(title);
        li.append(link);
        return li;
      }));
    });

    // お知らせページ：全件（タイトル・日付・本文）
    document.querySelectorAll("[data-news-archive]").forEach(archive => {
      archive.replaceChildren(...items.map(item => {
        const article = document.createElement("article");
        article.className = "news-entry";
        article.id = item.id;
        article.setAttribute("aria-labelledby", `${item.id}-title`);
        const time = createDate(item);
        if (time) {
          const date = document.createElement("p");
          date.className = "news-date";
          date.append(time);
          article.append(date);
        }
        const heading = document.createElement("h2");
        heading.id = `${item.id}-title`;
        heading.textContent = item.title;
        article.append(heading);
        article.append(...window.SatoCms.paragraphs(item.body));
        return article;
      }));
    });
  }

  const fallback = Array.isArray(window.SATO_NEWS) ? window.SATO_NEWS : [];
  render(fallback);
  const foundAtFirst = window.SatoCms.scrollToHash();

  window.SatoCms.load("news").then(data => {
    if (!data) return; // 読み込めなかったときは、js/news-data.js の内容のまま
    render(data.items);
    if (!foundAtFirst) window.SatoCms.scrollToHash(); // 新しく足したお知らせへのリンクにも移動できるように
  });
})();
