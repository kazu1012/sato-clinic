# 佐藤医院 院内システム（お知らせ・よくあるご質問・ご相談の管理）

医院のスタッフが、ボタン操作だけで次のことをするための仕組みです。

- **ご相談**：Webフォームから届いたご相談の一覧・くわしい内容・対応状況（未対応／対応中／完了）・メモ・Gmail での返信
- **お知らせ**：追加・編集・並べ替え・公開／非公開・プレビュー
- **よくあるご質問**：追加・編集・並べ替え・公開／非公開・トップページに出すかどうか・プレビュー

## しくみ

```
院内システム（Apps Script「佐藤医院 院内システム」・医院のアカウントだけが開ける）
      │ 書き込む
      ▼
スプレッドシート「佐藤医院 ご予約・ご相談 受付一覧」
  ├ シート「受付一覧」……Webフォームから届いたご相談
  ├ シート「お知らせ」
  └ シート「よくあるご質問」
      ▲ 「公開」の行だけを読む
      │
Apps Script「佐藤医院フォーム」（site/sato-contact/gas/Code.gs の doGet）
      ▲ …/exec?type=news ／ …/exec?type=faq
      │
公開サイト（site/js/cms.js → news.js・faq.js）
  ※読み込めないときは、js/news-data.js と faq.html にもとから書いてある内容で表示する
```

## ファイル

| ファイル | 内容 |
|---|---|
| `admin/Code.gs` | 院内システムのプログラム（Apps Script「佐藤医院 院内システム」に貼るもの） |
| `admin/index.html` | 院内システムの画面（同じプロジェクトに「index」という名前の HTML ファイルとして貼るもの） |
| `test/` | 自動テスト（Apps Script のまねで、サーバー・画面・公開サイトを確かめる） |

## Google 側の設定（済み・2026年11月14日）

- アカウント：sato.clinic.test2026@gmail.com（課題用のテストアカウント）
- 「佐藤医院 院内システム」：`setupCms` を1回実行 → ウェブアプリとして公開（次のユーザーとして実行：自分／アクセスできるユーザー：自分のみ）
- 「佐藤医院フォーム」：`doGet` に読み出し口を足したので、「デプロイを管理」→ 鉛筆 →「新しいバージョン」で公開し直した（URL は変わらない）

## テストの動かし方

```
cd cms
node test/server.test.js ../site/sato-contact/gas/Code.gs
node test/ui.test.js ../site/sato-contact/gas/Code.gs     # playwright が必要
node test/site.test.js ../site                             # playwright が必要
```
