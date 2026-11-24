# Gate 2 テスト観点網羅性レビュー記録（描画の多層防御と未暗号化の保存データの他タブ更新）

**実施日**: 2026年11月24日<br>
**レビュワー**: 独立サブエージェント（Gate 2 テスト観点レビュワー、読取専用。各回とも別個体）<br>
**対象**: R-26・R-27 の試験（新規: `tests/unit/render-html.test.js`・`tests/unit/guest-cross-tab.test.js`・`tests/system/style-trusted-types-static.test.js`・`tests/system/headless-render-hardening.test.js`・`tests/system/headless-guest-cross-tab.test.js`。改め: I-15-08・I-16-07 の既存の試験と `tests/helpers/dom-mock.js`・`tests/scripts/stress/test-limits.json`）、実装の下書き（変異の当て込みの対象。Gate 3 で審査する）<br>
**比較元**: `eaec46a`<br>
**設計**: [Gate 1 の記録](review95_csp_guest_tabs_gate1.md)（3回目の是正をもって通過）

## Stage 4 の記録

### 1. 着手前の不安定な試験の一掃

- 比較元のコードと試験で、実Chromium の試験ファイル（`tests/system/headless-*.test.js`。17本）は3回、それ以外のすべての試験ファイル（開発用のスクリプトの試験を除く。50本）は10回、`repeat-tests.js --coverage --load 2` で実行し、保存の遅延の変異（`tests/scripts/stress/save-delay.json`）を当てた（68単位。2026-11-24 00:25〜00:55Z。影響範囲の一覧の名前を含まない試験ファイルが少ないため、すべてを対象とした）。
- 67単位は合格した。`tests/system/headless-access-mobile.test.js` の1単位は、試験「Hata normal: 1280px all 120 counts are reachable by scrolling and toggling preserves totals」が3回のうち2回落ちて不合格だった（この単位は通常の20秒に対して55秒かかった）。
	- 同じ時間帯に Gate 1 の2回目のレビュワーが別の Chromium で実験していた。その後、条件を変えて計32回実行し、失敗は0回だった（単独で3回、負荷の子プロセス2つで5回、ファイル全体を網羅の計測と負荷つきで3回、読んだファイルの記録と負荷つきで3回、単位の実行の仕組みで3回（20秒）、負荷の子プロセス4つで10回、別の実Chromium の試験と同時に5回）。
	- 標準の条件（`--load 2`）では再現しないため、外部の Chromium の負荷による上限（10000ms）の超過と判断し、試験は直さなかった。以後、一掃と変異の当て込みは、レビュワーの実験と時間帯を重ねないように実行する。

### 2. 試験の実装

- 新規の試験（I-15-06・I-16-06。観点は追跡表の第19節）:
	- `tests/unit/render-html.test.js`（9件）: 描画の補助の取り除き（要素・子孫・属性・値・コメント・空の HTML）と記録、ポリシーの有無（ポリシーを通して解析すること）、`createScriptURL` の拒否、Service Worker の登録に渡す値、`setPassFeedbackState`、パスワードの欄の初期化（解除の誤りの表示の状態は残す）。
	- `tests/system/style-trusted-types-static.test.js`（5件）: HTML を入れる操作・ポリシー・`style` の語・スタイルの API・`className` の代入の固定、照合の関数ごとの違反の試料と除く形の試料、移し先のクラスの定義と使用と詳細度、印刷の向きの link・スタイルシート・sw.js。
	- `tests/system/headless-render-hardening.test.js`（8件）: 全画面・モーダル・帳票・印刷の CSP 違反と取り除きが0件（1280px・375px）、移し先のクラスの効果（全状態の全要素の computed style）、Trusted Types の強制、注入の試料の取り除き、CDP で入れたインライン style の拒否、印刷の向き、表示の切替と Esc。
	- `tests/unit/guest-cross-tab.test.js`（24件）: 既知値の記録と照合、読込の前の保存の拒否と最初の読込の失敗、4つのデータキー以外を照合しないこと、反映の失敗、読込の結果と世代、排他区間の順序（到着の順に1つずつ通す偽の Web Locks）、取込・復元（暗号化中の暗号化の途中の書込みを含む）・暗号化の設定（直列化の前に拒否し鍵の生成と認証器の登録をしないこと、取引の前、暗号化中の再設定）、Web Locks がないとき、平文のロック（その後も保存できること）と全消去、処理中の取消、起動時の既定値（毎回新しい写し）・修復・やり直し・予期しない失敗（描画すること）・案内を出さないこと、読み直しの手順と結果ごとの扱い（保存の拒否の解除、最初の世代の前進で出力が止まること）、storage の通知の保留・直列化、カードからの設定の競合、暗号化中の解除で停止中のキーを読まないこと（I-12-07）、提出後の消去（暗号化中の解除の間の拒否も通知する）、BL-007。
	- `tests/system/headless-guest-cross-tab.test.js`（5件）: 2つのウィンドウでの読み直しと案内、排他の待機中の競合、全消去の後、家庭情報入力と提出後の消去の競合、取込・復元・暗号化の設定の競合。
- 既存の試験の改め（I-15-08・I-16-07）:
	- `tests/system/csp-external-block.test.js`: CSP の期待値と許可元、Service Worker の登録とポリシーの `createScriptURL`、js/hata.js の行の固定、スペルチェックの固定に描画の補助の2行を加えた（設計の I-14-02 にも書いた）。
	- `tests/system/headless-csp-external.test.js`: script・object・Worker は Trusted Types の TypeError を確かめ、object の `object-src` は CDP の `DOM.setOuterHTML` で、style の `url()` は CSSOM で、`@font-face` は構築したスタイルシートで、`@import` は一時のスタイルシートで確かめる。違反の判定は Trusted Types の違反を数える。
	- `tests/system/headless-security.test.js`: script の `textContent`・`setAttribute('onclick')` の TypeError、`eval`・`new Function` の EvalError、CDP で入れたイベント属性の `script-src-attr`。
	- `tests/system/headless-workflows.test.js`: 印刷の向きを link の `media` で確かめる。ページの中の `innerHTML` を描画の補助にした。`tests/system/headless-specification-contracts.test.js` の2か所も同じ。
	- `tests/unit/security-render-coverage.test.js`: 座席表の列の `data-cols` と描画の後のスタイル、範囲の外の値、代表の印刷で描画の後に列を設定すること（試験を2件加えた）。
	- 変異の当て込みで、クラス名を変えた行の既存の値の既定値（`x || ''`）の変異が生き残ったため、描画した値を確かめる試験を加えた: `tests/unit/rep.test.js`（地区の詳細の画面の全項目）、`tests/unit/transfer.test.js`（児童の氏名と組、旧形式の組の移行）、`tests/unit/neighbor.test.js`（自治会の表の住所・電話・メール・備考）、`tests/unit/hata.test.js`（一覧の表示の曜日と `day` への置き換え）、`tests/unit/print.test.js`（役員の名簿の役職と空のときの「校外委員」）。
	- `tests/system/browser-runtime-evaluation.test.js`: 偽の DOM に template の内容と `replaceChildren` を加え、js/transfer.js の読込の関数がないことを確かめる。
	- `tests/unit/transfer.test.js`・`tests/unit/household-transfer.test.js`: js/transfer.js の保存・読込の関数を使っていた試験を、js/state.js の保存と、保存値の検証と描画で戻る形にした。読込の関数の例外の試験は、関数ごと除いたので消した。
	- 試験が保存領域を直接用意してから、起動時の読込なしに保存・取込・復元・暗号化の設定を呼んでいた試験（`tests/unit/security-crypto.test.js`・`tests/unit/security-kdf.test.js` の「タブ」の作成、`tests/unit/browser-handoff.test.js`・`tests/unit/branch-coverage.test.js`・`tests/unit/security-output-lifecycle.test.js`・`tests/unit/household-transfer.test.js`・`tests/unit/transfer.test.js`）に、アプリの起動時と同じ未暗号化の読込を加えた（`tests/helpers/dom-mock.js` の `recordStoredValues`。未暗号化の読込がない比較元では何もしない）。`tests/unit/crypto.test.js` は、保存領域の直接の消去をアプリの全消去にした。
	- `tests/unit/save-invariant-coverage.test.js`: 起動時の予期しない失敗を、未暗号化の読込の反映の中の失敗（正規化の関数の1回目）で起こす形にし、保存値のないモードが保存できることを加えた。`tests/unit/security-core-coverage.test.js`: 保存値のないキーは js/state.js の初期値で開くため、地区のデータを保存値として置いて読まれることを確かめる形にした。
	- `tests/unit/security-save-invariant.test.js`・`tests/unit/security-state.test.js`: 平文の storage の通知の後に読み直しが終わるのを待ち、ロックせずに案内が出ることを確かめる形にした。`tests/unit/security-crypto.test.js` の暗号化中の再設定の試験は、他タブの保存の後の再設定が拒否され、保存値が残ることを確かめる形にした（I-16-02 で意図して変えた挙動）。
	- `tests/helpers/dom-mock.js`: template の解析・子と属性の一覧・`replaceChildren`・取り除いたかの記録を加え、取り除かなかったときは入れた文字列を読み返す。`removeAttribute` で `type` も消す。
	- `tests/scripts/stress/test-limits.json`: 移し先のクラスの効果の試験（120000ms）の規則を加えた。

### 3. 実装がない状態での確認

比較元（`eaec46a`）の本番のコードに今の試験を重ねて実行した（作業用の写し）。Gate 2 に出す前に、変異の当て込みで加えた試験を含めて取り直した。

| 試験ファイル | 比較元での結果 | 区分 |
| :--- | :--- | :--- |
| `tests/unit/render-html.test.js` | 9件すべて不合格 | 変える |
| `tests/unit/guest-cross-tab.test.js` | 22件不合格、2件合格（起動時の予期しない失敗で保存値のあるキーを停止すること、暗号化中の解除で停止中のキーを読まないこと（I-12-07）。比較元と同じ挙動） | 変える（2件は変えない） |
| `tests/system/style-trusted-types-static.test.js` | 4件不合格、1件合格（照合の関数の試料。コードに依らない） | 変える |
| `tests/system/headless-render-hardening.test.js` | 5件不合格、3件合格（全画面の CSP 違反0件の2件と、表示の切替と Esc） | 変える（3件は変えない） |
| `tests/system/headless-guest-cross-tab.test.js` | 5件すべて不合格 | 変える |
| `tests/unit/security-render-coverage.test.js` | 座席表の列の3件が不合格、8件合格 | 変える（ほかは変えない） |
| `tests/system/browser-runtime-evaluation.test.js`・`tests/system/csp-external-block.test.js`（5件）・`tests/system/headless-security.test.js`（1件）・`tests/system/headless-csp-external.test.js`（1件）・`tests/system/headless-workflows.test.js`（2件）・`tests/system/headless-specification-contracts.test.js`（1件） | 改めた試験だけが不合格 | 変える |
| `tests/unit/security-crypto.test.js` | 73件合格、暗号化中の再設定の1件が不合格 | 変えない（1件は変える） |
| `tests/unit/security-save-invariant.test.js`・`tests/unit/security-state.test.js` | 平文の通知の試験の各1件が不合格、ほかは合格 | 変えない（各1件は変える） |
| `tests/unit/crypto.test.js`・`tests/unit/security-kdf.test.js`・`tests/unit/browser-handoff.test.js`・`tests/unit/household-transfer.test.js`・`tests/unit/transfer.test.js`・`tests/unit/save-invariant-coverage.test.js`・`tests/unit/security-core-coverage.test.js`・`tests/unit/branch-coverage.test.js`・`tests/unit/security-output-lifecycle.test.js` | すべて合格 | 変えない |
| `tests/unit/rep.test.js`・`tests/unit/neighbor.test.js`・`tests/unit/hata.test.js`・`tests/unit/print.test.js`（変異の当て込みで加えた値の試験） | すべて合格 | 変えない |

- 取り直しで、`tests/unit/print.test.js` の役員の名簿の試験が、移し先のクラス名まで固定していたため比較元で落ちた。試験の目的は値なので、役員の行（氏名のセルの次の役職のセル）で確かめる形に直した（セルだけで確かめると、代表三役の連絡先の表にも役職が出るため、既定値の変異が生き残った）。js/print.js の自動の変異の単位をやり直し、合格した（5件すべて検出）。

### 4. 実装の下書きと、Stage 4 で決めた細部

- 下書き（Stage 6 の先行）は、I-15・I-16 のとおり、js の13本・sw.js・index.html・css/style.css・css/print-landscape.css（新規）に入れた。下書きのもとで、単体・結合の試験 868件と実Chromium・静的の試験 304件がすべて合格した。
- style 属性の移し替えは作業用のスクリプトで機械的に行った（index.html の239か所、js の181か所。191個の移し先のクラス。属性ごとのクラスは不要だった）。js の HTML を入れる箇所の52か所（描画30・消去22）も、作業用のスクリプトで描画の補助と `replaceChildren()` に替えた。
- 見た目の同等（I-15-07）: 比較元と下書きの index.html を同じ Chromium で開き、27の状態（全モード・モーダル・帳票の印刷・旗振り表の印刷・パスワードの確認の表示・ロックの後・印刷のメディア）×2つの画面幅で全要素の computed style を比べ、差は0件だった（構造の差は head の中だけ。印刷の向きの link を加えたことと、比較元の旗振り表の印刷の `<style>` 要素による）。最終のコードで検証記録のためにもう一度行う。
- Stage 4 で決めた細部（設計書に反映した。Gate 2 の審査の対象に含める）:
	- 照合と既知値の記録は4つのデータキーだけとする（I-16-02。下書きが4つのデータキー以外の保存まで拒否していたのを、`tests/unit/save-invariant-coverage.test.js` の既存の試験で見つけて直した）。
	- 未暗号化の読込の反映の失敗では、同じ排他区間の中で保存値のあるキーを停止し、保存値のないキーの既知値を `null` にしてから送出する（I-16-03 の手順5。比較元の起動時の予期しない失敗と同じく、保存値のないモードは保存できる）。
	- 提出後の消去は、暗号化中のロック（メモリだけで入力する）と保存の停止による `false` では、従来どおり消去を完了とする（I-16-02）。
	- パスワードの確認の表示の補助 `setPassFeedbackState`（js/utils.js）と、座席表の列の補助 `applyPrintSeatColumns`（js/print.js）を設けた（I-15-05）。
	- スペルチェックの字句の固定（I-14-02）に、描画の補助の許可リストと値の判定の2行を例外として加えた。
	- `tests/system/headless-chrome.test.js` の初めの表示の3件は、起動時のモードの切替が要素のスタイルを設定するため落ちず、改めなかった（I-15-06・I-15-08 から除いた）。
- 下書きの写し: Stage 7 の当て直しの `--since` のため、Gate 2 に出す時点の比較元から変えた js・sw.js の写しを、作業用のフォルダ（`draft-g2/`）に保存する。

### 5. 変異の当て込み

- 単位: 比較元から変えた js の13本ごとに、比較元から変わった行への自動の変異（`mutate.js --auto <ファイル> --since <比較元の写し>`）と、規則ごとの一覧の変異（`--spec`。10本で計97件。js/utils.js 34・js/crypto.js 22・js/app.js 24・js/print.js 5・js/hata.js 3・js/transfer.js 3・js/state.js 2・js/events.js 2・js/rep.js 1・sw.js 1）。試験は、単位ごとにその対象を確かめる試験のファイルとし、実Chromium の重い2件（全状態の移し先のクラスの比較と全画面）は `--skip-pattern` で変異ごとには実行しない（I-15-06 の試験として、全件の試験の実行で確かめる）。実Chromium の試験を使う単位と単体試験だけの単位を2つの流れで並べて実行し、後に試料のプロセスと mutate.js の写しが残っていないことを確かめた。
- 1回目（2026-11-24 05:17〜05:43Z）: 自動の変異で `--lines` を使ったため、変わった行に演算子のない4本（js/district.js・js/seat.js・js/state.js・js/handoff.js。テンプレートの置き換えだけ）が「候補0件」で不合格になった。比較元の写しを与える `--since` に改めた（候補0件は合格）。生き残った変異は次のとおり扱った。
	- クラス名を変えた行の既存の値の既定値（`x || ''` → `x && ''`。js/rep.js の24件ほか）: 描画した値を確かめる試験を加えた（上の 2.）。
	- 新しいコードの変異: 試験を加えた（4つのデータキー以外の保存、最初の読込の失敗、平文のロックの後の保存、設定の拒否で鍵の生成と認証器の登録をしないこと、暗号化中の復元の取引の前の照合、提出後の消去の各場合、起動の後に案内が出ないこと、予期しない失敗の後の描画、既定値の写しが毎回新しいこと、ポリシーを通して解析すること、パスワードの欄の初期化、代表の印刷の座席表の列）。
	- js/app.js の起動の `let loaded = false` は、どの経路でも上書きされる意味のない初期値だったため、初期値を置かない形にした。
	- 規則ごとの一覧に、js/app.js の未暗号化の起動・読み直し・storage の処理・設定の呼出元・Service Worker の登録の規則（26件）を加えた。
- 2回目（05:50〜06:29Z。入力が変わった単位）: 生き残ったのは、js/app.js の自動の4件と一覧の5件、js/transfer.js の自動の2件。
	- 設定の呼出元の明示の判定（`STORAGE_SESSION_CHANGED` では失敗を通知しない）は、読み直しが設定の画面を閉じて処理を取り消すため、判定に届くのは読み直しを保留にしたときだけだった。読み直しを、保留にするときも先に画面を閉じる形に改め、呼出元の明示の判定を除いた（設計の I-16-02・I-16-03 に反映）。起動の描画は、比較元と同じく読まなかったときも行う形にした（メモリを変えていないので結果は同じ。I-16-03 に反映）。
	- 試験を加えた: 修復が要る平文の保存値の起動時の修復、読み直しによる保存の拒否の解除、最初の世代の前進による出力の停止、暗号化中の解除で停止中のキーを読まないこと（I-12-07）、暗号化中の解除の間の提出後の消去の拒否の通知。
	- `unencryptedSessionStarting` の初期値（js/app.js）と、家庭情報の組の2つ目の既定値（js/transfer.js の53行。理由は下の等価の一覧）は等価とした。
- 3回目（06:32〜07:12Z）: 保留にするときも画面を閉じることの一覧の変異が生き残ったため、読み直しの実行中の通知で画面が閉じる試験を加え、その試験のファイルを入力に持つ8単位をやり直した（07:13〜07:55Z）。
- 4回目（Gate 2 に出す前）: 上の 3. の取り直しで直した `tests/unit/print.test.js` を入力に持つ js/print.js の自動の変異の単位をやり直した。css/style.css の注記の行頭の空白をタブに直した変更（コメントの中だけ）で入力が変わった8単位（自動の変異 js/hata.js・js/events.js・js/rep.js・js/handoff.js、一覧の変異 events・hata・rep・sw）は、Stage 7 の当て直しでやり直す。
- 結果: 23単位すべて合格。自動の変異は計121件（js/app.js 36・js/rep.js 27・js/utils.js 22・js/transfer.js 13・js/crypto.js 10・js/print.js 5・js/hata.js 4・js/neighbor.js 3・js/events.js 1。ほかの4本は候補0件）、一覧の変異は97件で、等価の6件のほかはすべて検出。
- 等価とした変異（理由は、一覧の変異の `equivalent` と自動の変異の等価の一覧に書いた。単位の記録は作業用のフォルダの `bl/units/` の下（results/・specs/）にある）:
	- js/app.js 1110:34 `false` → `true`（`unencryptedSessionStarting` の初期値）: 起動の処理が最初に真にして終わりに偽にするまで読まれず、起動の前に読み直しが求められる経路がない。
	- js/transfer.js 53:155 `||` → `&&`（家庭情報の組の2つ目の既定値）: 描画の直前（同じ関数の35行）の正規化の後、2つ目の `||` の右に届くのは、組（`className`）が空で旧形式の組（`class`）が空か未定義のときだけである（`class` が空でない文字列なら、35行が `className` に写す）。このとき元の式は `''`、変異は `class`（`''` か `undefined`）で、`esc` は `undefined` を空にするため、出力は同じ。保存値の検証（js/utils.js の家庭情報の検証）は `class` を文字列か未定義に限る（Gate 2 の1回目の指摘で理由を改めた）。
	- 一覧の変異「foreign: encrypted keys without a known value refused」: 暗号化中の照合は解除の間にだけ行われ、解除・設定・取引が4つのキーの既知値をいつも記録するため届かない分岐。
	- 一覧の変異「lock: encrypted known values kept」: ロックの間の保存・取込・復元・設定は照合の前に拒否され、次の解除が既知値を記録し直す。（Gate 2 の1回目の是正の後は、試験の補助がこの挙動を使うため検出になり、等価の扱いを外した。下の「2回目に出す Stage 4 の結果」）
	- 一覧の変異「replace: plaintext not compared before encoding」: 平文の復元では2回の照合の間に `await` がなく、2回目が同じ判定をする。
	- 一覧の変異「load: failure records every key」: 反映の失敗で、保存値のあるキーは同じ排他区間で停止されるため、その既知値は使われない。（Gate 2 の1回目の指摘で誤りとわかった。停止中のキーを解く置換の取込と復元がこの既知値で照合するため、等価の扱いをやめ、反映の失敗でも読んだ値を記録する形に実装を改めた。下の「1回目」の節）

## 1回目 — 要是正（Stage 4）

指摘は8件（ゲートを止める指摘5件、将来の潜在の経路だけの指摘1件、文書だけの指摘2件）。`finding-scope.js --from-snapshot` では、すべて差分の中で、変更外とした指摘はない。

ゲートを止める指摘:

- js/crypto.js:1256: 一覧の変異「load: failure records every key」を等価とした理由が誤り。反映の失敗の後、停止中のキーを解く置換の取込（`allowSuspended`）と引き継ぎの復元が、記録のない既知値との照合で拒否され、読み直し・同じ失敗を繰り返す（比較元は書き込んで停止を解く。比較元からの退行）。
- js/app.js:1095・1096: 読み直しで保存の停止を解いても、停止の警告（`#storage-save-warning`）が次の保存まで消えない（再開の `resumeStorageWrites` は報告を保留にするだけで、警告を描くのはその前の `clearStorageSaveRejections`）。保存値のないキーだけを再開する変異が生存する。
- js/app.js:1180・1181: 読み直しで読めない保存値・修復が要る保存値の通知を外しても試験が合格する。読み直しの場面の読めないキーの停止の試験がない。
- js/app.js:1140: 起動時の例外での停止を外しても試験が合格する（改めた試験は反映の中で例外を起こすため、手順5が先に停止する）。反映の外の例外（排他区間の要求の失敗など）は手順5を通らず、既知値が記録されないため、保存値のないモードの保存が拒否される（比較元は保存できる）。既知値のない状態の確かめも、全消去が既知値を記録するため成り立たない。
- js/transfer.js:222: 暗号化中で解除しているときの提出後の消去の競合の試験が、実際の経路と違う。実際は照合の失敗で保存の中でロックする（SEC-34）ため、保存の後の判定が「暗号化中のロック」とみなし、完了（`true`）を返して通知しない。

将来の潜在の経路だけの指摘（4.1 の 5.）: style-trusted-types-static.test.js:37（`className` の代入の固定が、`el['className'] =`・`Object.assign(el, { className })`・`setAttribute('class', …)`・`setAttributeNS`・`classList.value =` を検出しない）。

文書だけの指摘（4.1 の 4.）: internal_design.md:972（I-16-06 の家庭情報入力モードの実Chromium の試験の範囲が、実際の試験と違う）、review96:92（js/transfer.js 53:155 の等価の理由が誤り）。

### 是正（Stage 4 に戻って直した。4.1 の 8.）

ゲートを止める指摘:

- 反映の失敗（I-16-01・I-16-03 の手順5）: 同じ排他区間の中で、読んだ値を4つのキーの既知値として記録する。停止するのは、メモリの元の値（既知値。ないときは `null`。起動の前のメモリは js/state.js の初期値）と読んだ値が異なるキーとした。起動時は比較元と同じく保存値のあるキーが停止し、読み直しでは別のタブが書き換えたキー（削除を含む）だけが停止する（書き換えていないキーのメモリはその保存値に基づくので保存できる。以前の「保存値のあるキーをすべて停止し、保存値のないキーを `null` とする」では、読み直しで別のタブが消したキーに古いメモリを保存できた）。停止中のキーは、比較元と同じく置換の取込・復元・全消去で解ける。
- 起動時の反映の外の例外（I-16-03）: js/crypto.js に `rememberUnreflectedStorageValues` を新設し、起動時の例外の処理で、既知値のないキーにそのときの保存値を記録する（既知値のあるキーは変えない。手順5の記録の後の別のタブの書込みを照合で見つけるため）。保存値のあるキーの停止と通知は従来どおり。読み直しの反映の外の例外は、既知値も停止も変えず、別のタブが書き換えたキーの保存は照合で拒否されて読み直しを求める（I-16-03 に書いた）。
- 停止の警告（js/app.js `applyUnencryptedStorage`）: 再開と停止の後に `clearStorageSaveRejections` を呼び、警告を描き直す。読み直しの「読んだ」の通知（読めないモード・修復）を I-16-03 と E-16-05 に書いた。
- 提出後の消去（js/transfer.js `resetTransferForm`、I-16-02・E-16-03）: ロック（メモリだけで入力する状態）を保存の前に判定する。暗号化中で解除しているときの競合は、SEC-34 のロックと理由の表示に加えて、未暗号化と同じく「消去できませんでした」を表示して `false` を返す。
- 試験を加え、改めた:
	- `tests/unit/guest-cross-tab.test.js`: 反映の失敗の試験に、別のタブが書き換えていない保存値のキーの保存、置換の取込・復元による再開、失敗の後の別のタブの書込みでの拒否を加えた。起動時の反映の中の失敗（既知値のない状態から。置換の取込による再開、保存値のないモードの保存）、反映の中で失敗する間の別のタブの書込みの拒否、起動時の反映の外の失敗（排他区間の要求を1回拒否する）の試験を加えた。読み直しの予期しない失敗は、別のタブが書き換えたキーだけが停止し、警告が出て、ほかのキーは保存できることを確かめる形にした。読み直しで、読めない値の停止・通知・警告・案内、読める値に変わった後と保存値がなくなった後の再開と警告の消去、修復の通知を確かめる試験を加えた。提出後の消去は、実際に別のタブが暗号文を書いた後のロックと通知と保存値を確かめ、差し替えの試験はロックを伴わない `false` の場合とした。
	- `tests/unit/save-invariant-coverage.test.js`: 起動時の予期しない失敗の2件を、既知値のない状態から、反映の中と外（排他区間の要求の失敗）の両方で確かめる形にし、保存値のないモードの保存を加えた（比較元でも合格する）。
- 比較元での確認（第3節の取り直しの写し）: `tests/unit/save-invariant-coverage.test.js` は15件すべて合格。`tests/unit/guest-cross-tab.test.js` は25件不合格、2件合格（起動時の反映の中の失敗の試験（置換の取込の再開を含め比較元と同じ）と I-12-07）。

将来の潜在の経路だけの指摘は、クラスを丸ごと置き換える・消す書き方（`el['className'] =`・`Object.assign` の `className`・`class` の属性の `setAttribute`・`setAttributeNS`・`removeAttribute`・`toggleAttribute`・属性のノードの取得・`attributes.class`・`classList.value =`・`classList =`）を照合に加えて0件に固定し、違反の試料と除く形の試料に加えた（4.1 の 5.。I-15-05 に書いた）。

設計書の改め（I-16-01〜I-16-03・I-16-06・I-16-07・I-15-05・E-16-03・E-16-05・追跡表の第19節）は、Gate 1 の利用者の決定（設計の残りは Gate 2・Gate 3 で確かめる）により、Gate 1 を受け直さず、Gate 2 の2回目の審査の対象に含める。

文書だけの指摘は、あわせて直した（4.1 の 4.）。I-16-06 は、自治会モードと家庭情報入力モードで確かめる項目を分けて書いた。js/transfer.js 53:155 の等価の理由は、35行の正規化の後に2つ目の `||` の右に届く場合（組が空で旧形式の組が空か未定義）と `esc` の扱いに改めた（等価の一覧も同じ）。

## 2回目に出す Stage 4 の結果（単位ごと）

- 試験: 単体・結合の試験 887件と、実Chromium・静的の試験 304件がすべて合格した（是正の後の作業ツリー）。
- 変異の当て込み（2026-11-24 08:50〜09:31Z。入力が変わった21単位を2つの流れで実行し、後に試験のプロセスと mutate.js の写しが残っていないことを確かめた。js/district.js・js/seat.js の自動の変異の2単位は入力が同じため記録を再利用した）:
	- 規則ごとの一覧を是正に合わせて改めた（計111件）。js/crypto.js の反映の失敗の6件を、停止の条件（既知値と読んだ値の比較、既知値がないときの `null`）・記録の有無と範囲・記録と停止の順・例外の握りつぶしの10件に替え、`rememberUnreflectedStorageValues` の3件（記録しない・既知値を上書きする・保存値を `null` とする）を加えた。js/app.js に、停止の警告の描き直しの順・保存値のないキーだけの再開・起動時の反映の外の失敗の記録と停止・読み直しの読めないモードと修復の通知の6件を加えた。js/transfer.js の提出後の消去は、ロックを保存の後に判定する・解除中も暗号化中ならメモリだけとみなすの2件を加えた（判定の式の3件は新しい式に合わせた）。
	- 1回目の実行で、一覧の変異「apply: warning drawn before resuming」が生き残った。変異の置換が、後ろの描き直しを残したまま前に描き直しを足すだけで、意味が同じだった（変異の誤り）。後ろの描き直しを除く形に改めてやり直し、検出した。
	- 一覧の変異「lock: encrypted known values kept」は、等価としていたが検出に変わった。是正で加えた、既知値のない状態を作る試験の補助（`forgetKnownValues`・`forgetKnownStorageValues`）が、暗号化中のロックで既知値が空になることを使うためである。等価の扱いを外した。
- 結果: 23単位すべて合格。自動の変異は計121件（js/app.js 36・js/rep.js 27・js/utils.js 22・js/transfer.js 13・js/crypto.js 10・js/print.js 5・js/hata.js 4・js/neighbor.js 3・js/events.js 1。ほかの4本は候補0件）、一覧の変異は111件で、等価の4件（js/app.js 1110:34・js/transfer.js 53:155・一覧の変異「foreign: encrypted keys without a known value refused」・「replace: plaintext not compared before encoding」。理由は第5節）のほかはすべて検出。単位の記録は作業用のフォルダの `bl/units/` の下（results/・specs/）にある。

## 2回目 — 要是正（Stage 4）

1回目の是正と、それが持ち込んだ問題を重点とした（4.1 の 7.）。指摘は5件（ゲートを止める指摘2件、文書だけの指摘2件、将来の潜在の経路だけの指摘1件）。`finding-scope.js --from-snapshot` では、js/crypto.js:29（変更したファイルの、宣言の前の注記。文書だけの指摘）のほかはすべて差分の中で、変更外とした指摘はない。

ゲートを止める指摘:

- tests/unit/guest-cross-tab.test.js:105・503・js/crypto.js:1257: 反映の失敗で停止するキーの条件について、別のタブがキーを削除した場合（既知値あり→読んだ値 `null`）と、加えた場合（既知値 `null`→読んだ値あり）の試験がない。削除したキーを停止しない変異と、加えたキーを停止しない変異が生存する（古いメモリ・既定値で、別のタブの全消去や新しい値を上書きする）。
- js/app.js:1125・1150: 起動時に、反映の関数が修復を見つけた後に失敗すると、修復した値を開いていないのに修復の通知を出す（`repairs` の配列を反映の関数と共有している）。比較元は修復の通知を出さない（退行）。

将来の潜在の経路だけの指摘（4.1 の 5.）: style-trusted-types-static.test.js:28（クラスの置き換えの照合が、論理代入（`||=`・`&&=`・`??=`）、行をまたぐ書き方、属性のノードの名前付きの操作（`getNamedItem`・`removeNamedItem`・`setNamedItem`・`setAttributeNode`・`createAttribute`）、`Reflect.set` を検出しない）。

文書だけの指摘（4.1 の 4.）: internal_design.md:893・899（既知値の定義と I-16-01 の冒頭が、1回目の是正で加えた記録と食い違う）、js/crypto.js:29（`knownStorageValues` などの宣言の前の注記が、暗号文だけ・平文の起動の停止だけの記述のまま）。

### 是正（Stage 4 に戻って直した。4.1 の 8.）

ゲートを止める指摘:

- 削除・追加の停止: `tests/unit/guest-cross-tab.test.js` に、反映の失敗で、別のタブが消したキーと加えたキーが停止し、古いメモリ・既定値の保存が拒否され、削除・追加がそのまま残ることを確かめる試験を加えた（比較元では落ちる）。2つの変異を規則ごとの一覧に加えた。追跡表の第19節に「削除・追加を含む」と書いた。
- 修復の通知: js/app.js `startUnencryptedSession` は、反映の関数ごとに新しい配列に修復を集め、反映が終わったときだけ引き継ぐ形にした（I-16-03 の起動時のほかの例外に書いた）。修復が要る代表の保存値を置き、正規化の段で予期しない失敗を起こしたとき、「安全な初期状態で起動しました」だけを出すことを確かめる試験を加えた（比較元でも合格する。試験の代表のデータは、比較元にない `defaultStateModels` ではなく試験の補助の `createMockRepState` で作る）。配列を共有に戻す変異と、修復を引き継がない変異を規則ごとの一覧に加えた。

将来の潜在の経路だけの指摘は、照合を、改行を空白にした内容（文字の位置は変わらない）に当て、一致の始まりの行を返す形にし、代入の演算子に論理代入を加え、属性のノードの取得・作成・名前付きの操作、`Reflect.set`・`Object.defineProperty` の `className`・`classList` を加えた。違反の試料（論理代入・行をまたぐ書き方・名前付きの操作・`Reflect.set`・`Object.defineProperty`）と除く形の試料（行をまたぐデータの `className`、`Object.assign` の後の別の文のデータ、行をまたぐ比較、`data-class` の名前付きの操作）を加えた（4.1 の 5.。I-15-05・追跡表に書いた）。

文書だけの指摘は、あわせて直した（4.1 の 4.）。既知値の定義を「照合の基準とする保存値」とし、記録する場面を I-16-01 に並べ、反映の失敗と起動時の反映の外の例外を例外として書いた。js/crypto.js の宣言の前の注記は、停止の理由（読み直しで読めないキー・反映の失敗）と、既知値が平文も持つことに合わせた。

## 3回目に出す Stage 4 の結果（単位ごと）

- 試験: 単体・結合の試験 889件と、実Chromium・静的の試験 304件がすべて合格した（是正の後の作業ツリー）。
- 変異の当て込み（2026-11-24 10:14〜10:56Z。入力が変わった21単位を2つの流れで実行し、後に試験のプロセスと mutate.js の写しが残っていないことを確かめた。js/district.js・js/seat.js の自動の変異の2単位は入力が同じため記録を再利用した）: 規則ごとの一覧に、2回目の是正の4件（反映の失敗で削除したキー・加えたキーを停止しない、起動時の修復の配列を共有に戻す、修復を引き継がない）を加えた（計115件）。4件とも検出した。
- 結果: 23単位すべて合格。自動の変異は計121件（js/app.js 36・js/rep.js 27・js/utils.js 22・js/transfer.js 13・js/crypto.js 10・js/print.js 5・js/hata.js 4・js/neighbor.js 3・js/events.js 1。ほかの4本は候補0件）、一覧の変異は115件で、等価の4件（2回目と同じ。理由は第5節）のほかはすべて検出。

## 3回目 — 要是正（Stage 4。要是正の3回目）

2回目の是正と、それが持ち込んだ問題を重点とした（4.1 の 7.）。指摘は5件（ゲートを止める指摘1件、文書だけの指摘3件、将来の潜在の経路だけの指摘1件）。`finding-scope.js --from-snapshot` では、internal_design.md:564・565（変更したファイルの、I-12-07 の記述。文書だけの指摘）のほかはすべて差分の中で、変更外とした指摘はない。

ゲートを止める指摘:

- js/app.js:1134・1154・internal_design.md:937・984: 起動時の未暗号化の読込が失敗すると（反映の中・外とも）、読めない保存値のモードの通知（「保存データを読み込めないため、…の保存を停止しました。…」）が出ない。読めないキーは反映の関数が最後まで戻ったときだけ呼出元へ渡るためである。比較元は読込の前に各キーを個別に検証するので、どちらの失敗でも「安全な初期状態で起動しました」の後にこの通知を出す（退行）。実装者の再現（読めない自治会・有効な家庭情報、既知値のない状態から、反映の中の失敗と排他区間の要求の失敗）: 比較元は通知が2件、作業ツリーは1件。停止するキーは両方とも自治会・家庭情報で同じ。

将来の潜在の経路だけの指摘（4.1 の 5.）: style-trusted-types-static.test.js:33・35・39・82・internal_design.md:821（クラスの置き換えの照合が、`Object.assign` の省略記法・引用符つきの名前・計算された名前、`Object.defineProperties`、分割代入の対象、`Reflect.set(el.classList, 'value', x)` を検出しない。`Reflect.defineProperty`・`classList`・`NS` の形の試料がなく、照合からそれらを外す変異が生き残る）。

文書だけの指摘（4.1 の 4.）: internal_design.md:564・565（I-12-07 が比較元の起動の流れのまま）、js/app.js:1109（起動の関数の注記の消し残し）、js/crypto.js:29（停止の理由に、未暗号化の起動の予期しない失敗がない）。

### 指摘の傾向（要是正が3回続いたため利用者に報告。4.1 の 7.）

- 回ごとの指摘: 1回目8件（ゲートを止める指摘5件）、2回目5件（2件）、3回目5件（1件）。ゲートを止める指摘は回ごとに減っている。
- 種類: ゲートを止める指摘の8件は、すべて BL-004 の未暗号化の読込の失敗の経路と、その周りにある。
	- 1回目: 反映の失敗の後の復旧、停止の警告の描き直し、読み直しの通知、起動時の反映の外の例外、暗号化中の提出後の消去。
	- 2回目: 反映の失敗で削除・追加したキーの停止の試験、起動時の修復の通知。
	- 3回目: 起動時の読めないモードの通知。
	- このうち比較元からの退行は、1回目の復旧、2回目の修復の通知、3回目の読めないモードの通知の3件で、どれも起動時の失敗の経路の副作用（通知・停止・既知値）である。
- 根本の原因: 比較元の起動は、各キーの個別の検証（読めないキーの停止と通知）と読込（失敗したら全キーの停止）を別々の段で行っていた。今回、それを1つの排他区間の中の反映の関数（`applyUnencryptedStorage`）にまとめた。このため、比較元で反映の前の段にあった副作用が、反映の関数が最後まで戻ったときだけ起きる形になった。失敗の経路の副作用を1つずつ直すたびに、隣の副作用が見つかっている。
- 将来の潜在の経路だけの指摘（クラスの置き換えの字句の固定）は、1回目から3回目まで続いている。字句の固定は網羅しきれない検査で、4.1 の 5. のとおり、反映して通過とする種類である。

### 利用者の決定

「総当たりで直して通過」とした。

- 3回目の5件を直す。
- 起動の失敗の経路を総当たりで確かめる試験を加え、比較元と作業ツリーで同じ結果になることを確かめる。経路は、失敗なし・反映の中の失敗・反映の外の失敗と、各キーの保存値（読めない・修復が要る・有効・なし）の組合せとし、通知・停止・保存の可否を見る。
- そのうえで Gate 2 を通過とする。残りは Stage 7 の変異の当て直しと Gate 3 で確かめる。

### 是正（まとめて直した。4.1 の 8.。利用者の決定によりこの回で通過とし、是正は Stage 7 の当て直しと Gate 3 で確かめる）

ゲートを止める指摘:

- 起動時の読めないモードの通知: js/app.js `startUnencryptedSession` の例外の処理で、比較元の起動の前の検証と同じく、保存値ごとに `validateStoredData`（`repair: true`）で検証して読めないキーを求め、「安全な初期状態で起動しました」の後に読めないモードの通知を出す（I-16-03・I-12-07 に書いた）。指摘の再現の手順で、反映の中と外の失敗のどちらでも、比較元と同じく通知が2件になった。
- 起動の経路の総当たりの試験（利用者の決定）: `tests/unit/startup-failure-matrix.test.js` を加えた。失敗なし・反映の中の失敗・反映の外の失敗と、自治会（なし・有効・読めない JSON）・家庭情報入力（なし・有効・形の不正）・校外代表（なし・修復が要る）の保存値の54通りについて、次が比較元の起動と同じであることを確かめる。
	- 通知（「安全な初期状態」・読めないモード・修復）の有無と順
	- 停止するキーと停止の警告
	- 自治会・家庭情報入力の保存の可否と、拒否したときの保存値
	- 校外代表の保存値を書き換えないこと
	- 試験ファイルは今回の変更で加えた関数を使わず、比較元のコード（第3節の取り直しの写し）でも合格した。今回の退行を戻すと、この試験が落ちる。
- 規則ごとの一覧に、例外の処理の検証の3件（読めないキーを求めない、修復が要る値を読めないとする、保存値のないキーを読めないとする）を加え、js/app.js と js/crypto.js の単位の試験に総当たりの試験を加えた。

将来の潜在の経路だけの指摘は、照合に `Object.assign`・`Object.defineProperties` の引数の `className`（省略記法・引用符・計算された名前を含む）、分割代入の対象の `className`・`classList`、`Reflect.set`・`Reflect.defineProperty`・`Object.defineProperty` の引数の `className`・`classList`（引用符なしを含む）を加えた。違反の試料（これらと、`NS` の形・`classList` の形）と除く形の試料（データの `className` の読出し、配列の要素の読出し、`Reflect.get`、別の名前、分割代入でない比較）を加えた（4.1 の 5.。I-15-05・追跡表に書いた）。

文書だけの指摘は、あわせて直した（4.1 の 4.）。
- I-12-07 は、未暗号化の読込（I-16-03）を参照する形にし、暗号化中の解除の読込が停止中のキーを読まないことを分けて書いた。
- js/app.js の注記の消し残しを消した（この1行で、等価の一覧の js/app.js の行が 1110:34 に戻った）。
- js/crypto.js の注記に、未暗号化の起動の予期しない失敗を加えた。

### 判定

利用者の決定（「総当たりで直して通過」）により、3回目の是正と総当たりの試験をもって Gate 2 を通過とした。3回目の是正が正しいかは、Stage 7 の変異の当て直しと Gate 3 で確かめる。Gate 3 の依頼文に、3回目の指摘と是正を示す。
