# 描画の多層防御と未暗号化の保存データの他タブ更新の検証記録

**実施日**: 2026年11月24日<br>
**対象**: 作業ツリー（未コミット）、比較元 `eaec46a`<br>
**関連記録**: [Gate 1 review95](review95_csp_guest_tabs_gate1.md)、[Gate 2 review96](review96_csp_guest_tabs_tests.md)、[Gate 3 review97](review97_csp_guest_tabs_gate3.md)、[残件台帳](../review_backlog.md)

## 1. 実施内容の要約

| 区分 | 内容 |
| :--- | :--- |
| 利用者の要求 | 「BL-3,4の対応をして。」（残件台帳の BL-003: `style-src 'unsafe-inline'` と Trusted Types が未導入、BL-004: 未暗号化のゲストデータの他タブ競合。関連する BL-007: `saveTransferLocal` の重複もあわせて対応） |
| 描画の多層防御（R-26） | CSP から `style-src 'unsafe-inline'` を除き、`require-trusted-types-for 'script'`・`trusted-types kogai` を加えた（E-14-01。`script-src-attr 'none'` は比較元からある）。HTML を入れる箇所は、許可リストで取り除く描画の補助（js/utils.js `renderHtml`）だけとし、Service Worker の登録の URL も `kogai` のポリシーを通す。index.html と js の style 属性を、css/style.css の末尾の移し先のクラス（191個）に移した。旗振り表の横向きの印刷は、css/print-landscape.css の link の `media` の切替にした（`<style>` 要素を使わない） |
| 未暗号化の他タブ更新（R-27） | 平文の保存データにも既知値を持ち、保存・取込・引き継ぎの復元・暗号化の設定の前に照合する。別のタブの書込みを受けたら、設定の画面と引き継ぎの画面を閉じて読み直し、案内（`#storage-foreign-update-notice`）を出す。読込・読み直しは1つの排他区間で行い、反映の失敗では別のタブが書き換えたキーの保存を停止する。家庭情報入力の提出後の消去は、競合したら「消去できませんでした」を出す |
| BL-007 | js/transfer.js の保存・読込の関数を除き、保存は js/state.js の `saveTransferLocal` だけにした |
| 設計書 | 要件 R-26・R-27、外部仕様 E-14-01・E-15・E-16、内部仕様 I-15・I-16（I-02・I-12-07・I-14-02 の関係する記述を含む）、追跡表の第19節。各文書は版 1.11 |
| 試験 | 新規の6ファイル（`tests/unit/render-html.test.js`・`tests/unit/guest-cross-tab.test.js`・`tests/unit/startup-failure-matrix.test.js`・`tests/system/style-trusted-types-static.test.js`・`tests/system/headless-render-hardening.test.js`・`tests/system/headless-guest-cross-tab.test.js`）と、既存の試験の改め（review96 の第2節） |
| ゲート | Gate 1・Gate 2 は、どちらも3回続けて要是正になった後、利用者の決定でその回の是正をもって通過とした（Gate 2 は起動の経路の総当たりの試験を加えて）。Gate 2 の3回目の是正は、Stage 7 の当て直しと Gate 3 で確かめる |

## 2. Stage 7: 機械的構文チェックと変異の当て直し

- `node tests/scripts/precheck.js --base eaec46a`: 問題なし（比較元にもある変更外 4件。残件台帳の BL-006 で扱う。BL-007 の `saveTransferLocal` の重複はなくなった）。
- 整理（Stage 6）: 変更の中に消し残し（`console.log`・`debugger`・作業の印）がないことを確かめた。整理で変えたコードはない。
- 変異の当て直し（2026-11-24 11:32〜12:15Z）: Gate 2 の3回目の是正の後の最終のコードに、単位ごとに、一覧の変異（`--spec`。10本で計118件。Gate 2 の3回目の是正の3件を加えた）と自動の変異を当てた。
	- 自動の変異は `--auto <ファイル> --since <比較元の写し>` とした。比較元から変わったすべての行が対象になり、決まり（Gate 2 に出した写しからの `--since`）の範囲を含む。
	- 入力が変わった20単位を実行し、入力が同じ3単位（自動の変異 js/state.js・js/district.js・js/seat.js）は記録を再利用した。実Chromium の試験を使う単位と単体試験だけの単位を2つの流れで並べ、後に試験のプロセスと mutate.js の写しが残っていないことを確かめた。
	- 結果: 23単位すべて合格。自動の変異は計126件（js/app.js 41・js/rep.js 27・js/utils.js 22・js/transfer.js 13・js/crypto.js 10・js/print.js 5・js/hata.js 4・js/neighbor.js 3・js/events.js 1。ほかの4本は候補0件）、一覧の変異は118件で、等価の4件のほかはすべて検出（時間切れによる検出を含む）。
	- 等価の4件（理由は review96 の第5節）: js/app.js 1110:34 `false` → `true`（`unencryptedSessionStarting` の初期値）、js/transfer.js 53:155 `||` → `&&`（家庭情報の組の2つ目の既定値）、一覧の変異「foreign: encrypted keys without a known value refused」・「replace: plaintext not compared before encoding」。
	- 単位の記録（出力・入力の SHA-256・一覧・等価の一覧）は、作業用のフォルダの `bl/units/` の下（results/・specs/）にある。実行の仕組み（`run-units.js`・`trace-reads.js`）は残件台帳の BL-008 のとおり、リポジトリには入れない。

結果（23単位。すべて合格）:

| 単位 | 入力の SHA-256（先頭12文字） | 入力の件数 | 結果 | 内容 | 所要時間 |
| :--- | :--- | ---: | :--- | :--- | ---: |
| 自動の変異 js/utils.js | `d2ece05f1787` | 18 | 合格 | 22件中 問題 0件（生存・無効・不合格） | 5秒 |
| 自動の変異 js/crypto.js | `865a060d3fbd` | 24 | 合格 | 10件中 問題 0件（生存・無効・不合格）（検出（時間切れ）1件） | 375秒 |
| 自動の変異 js/app.js | `47a87f3535a2` | 30 | 合格 | 41件中 問題 0件（生存・無効・不合格）（等価 1件・検出（時間切れ）3件） | 1286秒 |
| 自動の変異 js/state.js | `eb1ffd51193e` | 10 | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |
| 自動の変異 js/transfer.js | `52f723dfbf73` | 24 | 合格 | 13件中 問題 0件（生存・無効・不合格）（等価 1件） | 24秒 |
| 自動の変異 js/print.js | `bbaa87252155` | 20 | 合格 | 5件中 問題 0件（生存・無効・不合格） | 7秒 |
| 自動の変異 js/hata.js | `06762c162774` | 37（ブラウザー） | 合格 | 4件中 問題 0件（生存・無効・不合格） | 14秒 |
| 自動の変異 js/events.js | `34dc275fe5f3` | 36（ブラウザー） | 合格 | 1件中 問題 0件（生存・無効・不合格） | 27秒 |
| 自動の変異 js/rep.js | `fd59be49f2f7` | 37（ブラウザー） | 合格 | 27件中 問題 0件（生存・無効・不合格） | 158秒 |
| 自動の変異 js/district.js | `26c59969a721` | 9 | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |
| 自動の変異 js/neighbor.js | `a55191200d53` | 16 | 合格 | 3件中 問題 0件（生存・無効・不合格） | 5秒 |
| 自動の変異 js/seat.js | `60f3a6743ddf` | 9 | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |
| 自動の変異 js/handoff.js | `45c0e50cafef` | 33（ブラウザー） | 合格 | 下書きから変わった行に変異の候補がない | 0秒 |
| 一覧の変異 utils | `18f40c15e0bb` | 18 | 合格 | 34件中 問題 0件（生存・無効・不合格） | 6秒 |
| 一覧の変異 crypto | `5e5abb91c114` | 25 | 合格 | 30件中 問題 0件（生存・無効・不合格）（等価 2件） | 237秒 |
| 一覧の変異 app | `7ce610065819` | 26 | 合格 | 35件中 問題 0件（生存・無効・不合格）（検出（時間切れ）1件） | 577秒 |
| 一覧の変異 state | `59d690a3bb36` | 21 | 合格 | 2件中 問題 0件（生存・無効・不合格） | 3秒 |
| 一覧の変異 transfer | `6175a7b8c2ee` | 23 | 合格 | 5件中 問題 0件（生存・無効・不合格） | 10秒 |
| 一覧の変異 print | `ab1d8d14ab98` | 19 | 合格 | 5件中 問題 0件（生存・無効・不合格） | 6秒 |
| 一覧の変異 hata | `f30f07c275c4` | 35（ブラウザー） | 合格 | 3件中 問題 0件（生存・無効・不合格） | 11秒 |
| 一覧の変異 events | `1d8883ebee10` | 36（ブラウザー） | 合格 | 2件中 問題 0件（生存・無効・不合格） | 38秒 |
| 一覧の変異 rep | `0438da8def98` | 35（ブラウザー） | 合格 | 1件中 問題 0件（生存・無効・不合格） | 5秒 |
| 一覧の変異 sw | `f09d08f808f0` | 26 | 合格 | 1件中 問題 0件（生存・無効・不合格） | 1秒 |

- 見た目の同等（I-15-07）: 比較元と最終のコードの index.html を同じ Chromium で開き、27の状態（全モード・モーダル・帳票の印刷・旗振り表の印刷・パスワードの確認の表示・ロックの後・印刷のメディア）× 2つの画面幅（1280×900・375×800）で、全要素の computed style を比べた。差は0件。
	- 構造の差は head の中だけだった。印刷の向きの link を加えたことと、比較元の旗振り表の印刷の `<style>` 要素による。
	- 今回加えた他タブの更新の案内（`hidden`）は、どの状態でも表示されない（`display: none`）ことを確かめてから、要素の位置の番号と比較から外した。外さないと、後の兄弟の番号がずれて、同じ要素どうしを比べられない。

## 3. Stage 8: 全テスト実行とカバレッジ（`verify-twice.js`）

`node tests/scripts/verify-twice.js --out <作業ツリーの外>` の出力をそのまま貼る（2026-11-24 12:15〜12:27Z。Stage 7 の後に、ほかの試験と並べずに実行した。記録の置き場所は作業用のフォルダの `bl/verify1/`）。

| 検査 | 結果 |
| :--- | :--- |
| `npm test`（1回目） | 1194/1194件成功、fail 0・cancelled 0・skipped 0・todo 0、324907ms、終了コード0 |
| `npm test`（2回目、同一コード） | 1194/1194件成功、fail 0・cancelled 0・skipped 0・todo 0、364348ms、終了コード0 |
| SHA-256 照合 | 追跡対象と未追跡の新規ファイルの計228ファイルについて、2回の実行の前後で変更がないことを確認した |
| 検証したコードの SHA-256 | fc983c97dfceace513c02cfc2bdbb2416835db42b821be51dcc29699f992422c（docs/ を除く。コミットの前に `precheck.js --verified` で今のコードと照合する） |

| モジュール | Line % | Branch %（1回目） | Branch %（2回目） |
| :--- | ---: | ---: | ---: |
| `js/app.js` | 100.00 | 95.97 | 95.81 |
| `js/crypto.js` | 100.00 | 96.60 | 96.60 |
| `js/district.js` | 100.00 | 96.41 | 96.41 |
| `js/events.js` | 100.00 | 98.65 | 98.65 |
| `js/handoff.js` | 100.00 | 99.14 | 99.14 |
| `js/hata.js` | 100.00 | 96.10 | 96.10 |
| `js/neighbor.js` | 100.00 | 96.83 | 96.83 |
| `js/print.js` | 100.00 | 99.44 | 99.44 |
| `js/rep.js` | 100.00 | 96.76 | 96.76 |
| `js/seat.js` | 100.00 | 97.44 | 97.44 |
| `js/state.js` | 100.00 | 98.39 | 98.39 |
| `js/transfer.js` | 100.00 | 97.46 | 97.46 |
| `js/utils.js` | 100.00 | 98.91 | 98.91 |

| 試験ファイル | 件数 |
| :--- | ---: |
| `tests/integration/district-rep-sync.test.js` | 1 |
| `tests/integration/hata-polp-integration.test.js` | 1 |
| `tests/integration/neighbor-merge.test.js` | 5 |
| `tests/integration/print-pipeline.test.js` | 1 |
| `tests/integration/storage-flow.test.js` | 1 |
| `tests/integration/transfer-integration.test.js` | 3 |
| `tests/system/browser-runtime-evaluation.test.js` | 1 |
| `tests/system/csp-external-block.test.js` | 16 |
| `tests/system/headless-access-mobile.test.js` | 7 |
| `tests/system/headless-browser-handoff.test.js` | 3 |
| `tests/system/headless-chrome.test.js` | 9 |
| `tests/system/headless-csp-external.test.js` | 4 |
| `tests/system/headless-guest-cross-tab.test.js` | 5 |
| `tests/system/headless-hata-complete.test.js` | 7 |
| `tests/system/headless-household.test.js` | 3 |
| `tests/system/headless-import-leakage.test.js` | 3 |
| `tests/system/headless-lifecycle-security.test.js` | 6 |
| `tests/system/headless-next-year.test.js` | 3 |
| `tests/system/headless-render-hardening.test.js` | 8 |
| `tests/system/headless-runner.test.js` | 3 |
| `tests/system/headless-save-invariant.test.js` | 16 |
| `tests/system/headless-saved-data-audit.test.js` | 25 |
| `tests/system/headless-security-followup.test.js` | 14 |
| `tests/system/headless-security.test.js` | 19 |
| `tests/system/headless-specification-contracts.test.js` | 5 |
| `tests/system/headless-ui-audit.test.js` | 18 |
| `tests/system/headless-workflows.test.js` | 66 |
| `tests/system/static-analysis.test.js` | 3 |
| `tests/system/style-trusted-types-static.test.js` | 5 |
| `tests/system/sw-security.test.js` | 32 |
| `tests/system/system-matrix.test.js` | 21 |
| `tests/unit/access-version.test.js` | 2 |
| `tests/unit/app.test.js` | 28 |
| `tests/unit/branch-coverage.test.js` | 23 |
| `tests/unit/browser-handoff.test.js` | 14 |
| `tests/unit/chairman-fiscal-year.test.js` | 73 |
| `tests/unit/crypto.test.js` | 11 |
| `tests/unit/dev-scripts-check-docs.test.js` | 13 |
| `tests/unit/dev-scripts-finding-scope.test.js` | 5 |
| `tests/unit/dev-scripts-git.test.js` | 2 |
| `tests/unit/dev-scripts-impact.test.js` | 2 |
| `tests/unit/dev-scripts-js-lexer.test.js` | 1 |
| `tests/unit/dev-scripts-mutate.test.js` | 8 |
| `tests/unit/dev-scripts-precheck.test.js` | 4 |
| `tests/unit/dev-scripts-repeat-tests.test.js` | 8 |
| `tests/unit/dev-scripts-verify-twice.test.js` | 4 |
| `tests/unit/district.test.js` | 28 |
| `tests/unit/events-security.test.js` | 12 |
| `tests/unit/guest-cross-tab.test.js` | 29 |
| `tests/unit/handoff-guest-preserve.test.js` | 10 |
| `tests/unit/hata-complete.test.js` | 12 |
| `tests/unit/hata-input-drafts.test.js` | 4 |
| `tests/unit/hata-text-recovery.test.js` | 5 |
| `tests/unit/hata.test.js` | 23 |
| `tests/unit/household-transfer.test.js` | 4 |
| `tests/unit/import-output-hardening.test.js` | 19 |
| `tests/unit/neighbor.test.js` | 11 |
| `tests/unit/next-year-import.test.js` | 10 |
| `tests/unit/print.test.js` | 15 |
| `tests/unit/pwa-install.test.js` | 4 |
| `tests/unit/render-html.test.js` | 9 |
| `tests/unit/rep.test.js` | 38 |
| `tests/unit/save-invariant-coverage.test.js` | 15 |
| `tests/unit/seat.test.js` | 4 |
| `tests/unit/security-core-coverage.test.js` | 16 |
| `tests/unit/security-crypto.test.js` | 74 |
| `tests/unit/security-date-boundary.test.js` | 53 |
| `tests/unit/security-hata-output.test.js` | 6 |
| `tests/unit/security-import-commit.test.js` | 7 |
| `tests/unit/security-import-lifecycle.test.js` | 58 |
| `tests/unit/security-kdf.test.js` | 29 |
| `tests/unit/security-output-lifecycle.test.js` | 23 |
| `tests/unit/security-render-coverage.test.js` | 11 |
| `tests/unit/security-save-invariant.test.js` | 37 |
| `tests/unit/security-state.test.js` | 34 |
| `tests/unit/specification-contracts.test.js` | 16 |
| `tests/unit/startup-failure-matrix.test.js` | 1 |
| `tests/unit/state.test.js` | 7 |
| `tests/unit/transfer.test.js` | 16 |
| `tests/unit/ui-regressions.test.js` | 19 |
| `tests/unit/utils.test.js` | 19 |
| `tests/unit/version-consistency.test.js` | 1 |

| 時間のかかる試験（1回目） | ファイル | 所要時間 |
| :--- | :--- | ---: |
| R-25 / I-14-03: the static checks fail on copies that carry each documented violation sample | `tests/system/csp-external-block.test.js` | 23456ms |
| UI R-26: every migrated class has the effect of its declarations as an element style in every state | `tests/system/headless-render-hardening.test.js` | 18419ms |
| handoff SEC-25 (boundary & abnormal): unencrypted guest restore allows unedited default variants, wipes officer drafts/passwords/#hata-line-text, and rejects all officer boundary variants before confirm() | `tests/unit/browser-handoff.test.js` | 7901ms |
| mutate: a baseline run comes first, and results separate detected, surviving, equivalent, invalid and expected-pass mutants | `tests/unit/dev-scripts-mutate.test.js` | 7773ms |
| mutate: restoring across files, argument checks, line ranges without candidates and the timeout reaching the run | `tests/unit/dev-scripts-mutate.test.js` | 4513ms |
| QA-03: imported pupils with a grade outside 1-6 are rejected by name while blank placeholder rows are dropped | `tests/unit/import-output-hardening.test.js` | 3289ms |
| Mechanical syntax check: node -c across all production and test JavaScript files | `tests/system/static-analysis.test.js` | 3019ms |
| UI R-27: clearing all data in another window empties this tab and its print area, and old values never come back | `tests/system/headless-guest-cross-tab.test.js` | 3008ms |
| UI R-27: another window saving the neighborhood data makes this tab reload, show the notice and keep the newer value | `tests/system/headless-guest-cross-tab.test.js` | 2740ms |
| branch-booster: district.js and rep.js 95%+ branch coverage enhancements | `tests/unit/branch-coverage.test.js` | 2526ms |
