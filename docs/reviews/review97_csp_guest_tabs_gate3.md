# Gate 3 最終包括品質・セキュリティ監査記録（描画の多層防御と未暗号化の保存データの他タブ更新）

**実施日**: 2026年11月24日<br>
**レビュワー**: 独立サブエージェント（Gate 3 最終監査レビュワー、読取専用。各回とも別個体）<br>
**対象**: 比較元からの本番のコード（js/ の13本・index.html・css/style.css・css/print-landscape.css（新規）・sw.js）、試験（新規の6ファイルと既存の試験の改め）、設計書（R-26・R-27、E-14-01・E-15・E-16、I-15・I-16 ほか）と追跡表の第19節、残件台帳の BL-003・BL-004・BL-007、Gate 2 の3回目の是正（利用者の決定でこのゲートで確かめる）<br>
**基準**: [Gate 1 記録 review95](review95_csp_guest_tabs_gate1.md)、[Gate 2 記録 review96](review96_csp_guest_tabs_tests.md)、[検証記録 review98](review98_csp_guest_tabs_verification.md)<br>
**比較元**: eaec46a

## 1回目 — 文書だけの指摘（通過。4.1 の 4.）

指摘は4件で、すべて文書だけの指摘だった（ゲートを止める指摘・将来の潜在の経路だけの指摘・変更外の指摘はない）。`finding-scope.js --from-snapshot` では、internal_design.md:303・305・746・747・751（変更したファイルの、今回の変更が古くした記述）のほかは差分の中である。

- internal_design.md:88: I-02 の「読込は共有ロック、それ以外は排他ロック」に、未暗号化の読込（I-16-03）が読込を排他ロックの中で行う例外がない。
- internal_design.md:303・305: I-05 に、印刷の style の inline の許容と、一時の style を戻す記述が残っている（R-26 で `'unsafe-inline'` を除き、印刷の向きは link の `media` の切替にした）。
- internal_design.md:746・747・751・specification_traceability.md:422・426: I-14-03 と追跡表の第18節が、script 要素・インライン style の `@import`・`blob:`/`data:` の Worker を実Chromium の違反イベントで確かめる比較元の確かめ方のままで、R-26 で改めた確かめ方（Trusted Types の TypeError、一時のスタイルシートの link、`worker-src` は CSP の文字列の固定）と食い違う。
- review98:12: 加えた CSP の指令に、比較元からある `script-src-attr 'none'` を含めている。

### 反映（並行して直した）

- I-02 に、未暗号化の読込は読込・反映・既知値の記録・世代の前進を1回の排他ロックの中で行うことを加えた。
- I-05 を「スタイルのインライン許可は置かない（I-15）」と「タイトル・印刷の向きの link の `media`・表示を finally で戻す（I-15-05）」に改めた。
- I-14-03 の3つの手段と、追跡表の第18節の2か所に、R-26 で改めた確かめ方の注記（I-15-06・第19節）を加えた。
- review98 の CSP の記述から `script-src-attr 'none'` を外し、比較元からあることを書いた。

### 判定

文書だけの指摘のため、Gate 3 を通過とした（4.1 の 4.）。直したのは docs/ の下の文書だけで、検証したコードの SHA-256 の集約値は変わらない（`precheck.js --verified` で確かめた）。Gate 3 の後に直した文書のため、後続のゲートはなく、Stage 12 の PR レビューで確かめる（PR 本文のレビュー結果に、直した文書と内容を挙げる）。
