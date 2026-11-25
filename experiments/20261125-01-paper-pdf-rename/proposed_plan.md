# 論文PDFの自動ファイル名変更

## 1. 目的と使い方

Chromeの通常のダウンロード操作で、本文PDFと確認できた場合に出版年-筆頭著者の姓-論文タイトル.pdfで保存する。NatureとPMCの例は次の同じ名前で保存する。

```text
2021-Buphamalai-Network_analysis_reveals_rare_disease_signatures_across_multiple_levels_of_biological_organization.pdf
```

共通の書誌情報を掲載する出版社・大学リポジトリにも対応する。補足資料や判定できないPDFは元の名前で保存する。同名ファイルはChromeの連番で区別する。

## 2. 実装と確認

- Manifest V3のダウンロードイベントで保存名を指定する。
- 初回にサイトアクセスを許可した場合は、HTTPSページの書誌タグと本文PDFリンクを読み、そのリンクに対応する書誌情報をセッション内に保持する。
- PDF直リンクはDOIをCrossref、PMCIDをEurope PMCで照会する。Natureの記事番号からDOIを組み立てる。照会失敗、情報不足、判定の食い違いがあれば、最長3秒で元の名前に戻す。
- タイトルの空白を下線に置き換え、ファイル名に使えない文字を除く。長いタイトルは末尾を切り詰める。
- Nature、PMC、出版社別ルールを持たないページ、一般PDF、補足資料、照会失敗、重複保存を確認する。READMEに導入と設定の手順を記載する。
