# Gate 1 設計レビュー記録（描画の多層防御と未暗号化の保存データの他タブ更新）

**実施日**: 2026年11月24日<br>
**レビュワー**: 独立サブエージェント（Gate 1 設計レビュワー、読取専用。各回とも別個体）<br>
**対象**: `docs/requirements.md` v1.11（R-26・R-27）、`docs/external_design.md` v1.11（E-14-01・E-14-05・E-15・E-16）、`docs/internal_design.md` v1.11（I-15・I-16）、`docs/specification_traceability.md`（第19節）、`docs/review_backlog.md`（BL-003・BL-004・BL-007 の状態）<br>
**要求**: 利用者の指示「BL-3,4の対応をして。」（残件台帳の BL-003: `style-src 'unsafe-inline'` と Trusted Types が未導入、BL-004: 未暗号化のゲストデータの他タブ競合）<br>
**比較元**: `eaec46a`（main。今回の作業の着手前のコミット）

## Stage 1 の判断

- 残件台帳の未対応の項目のうち、BL-003・BL-004 を今回対応する。BL-007（`saveTransferLocal` の二重の宣言）は、BL-004 で変える家庭情報入力の保存の経路の上にあり、どちらの宣言が使われるかで照合の挙動が変わりうるため、あわせて対応する。BL-001・BL-002・BL-005（実機・旧版の保存値・実認証器）と BL-006（設計書の識別子の誤記）は今回の変更の範囲に関わらないため、未対応のままとする。BL-008（単位ごとの実行の仕組み）は開発の手順の残余で、今回は変えない。
- 実測（Chromium 150、file 起動、meta の CSP に `style-src 'self'; require-trusted-types-for 'script'; trusted-types kogai`）:
	- 文書の中で解析された style 属性と `<style>` 要素は拒否される。CSSOM による要素のスタイルの代入（`el.style.display`・`el.style.cssText`）と、構築したスタイルシート（`document.adoptedStyleSheets`）は拒否されない。`setAttribute('style', …)` は拒否される。
	- 文字列の `element.innerHTML` への代入は、空の文字列を含めて TypeError になる。`insertAdjacentHTML`・`DOMParser`・`range.createContextualFragment` も同じ。`kogai` の2つ目と別の名前のポリシーは作れない。
	- ポリシーを通して `<template>` で解析した HTML の style 属性は、解析の時点で `style-src-attr` の違反として拒否され、`element.replaceChildren` で文書へ移した後も効かない。ただし、その要素を `cloneNode`・`importNode` で複製すると、複製した要素では効く（1回目の指摘で訂正。当初の記録は、複製して移した結果を「移した結果」と誤って書いていた）。このため描画の補助は style 属性を取り除く（I-15-02）。
	- CDP の `DOM.setOuterHTML` で入れた要素は Trusted Types を通らず、CSP の `object-src`・`script-src-attr`・`style-src-elem`・`style-src-attr` の拒否を観測できる。この方法で入れた script 要素は実行の対象にならない。

## 1回目 — 要是正（Stage 2）

指摘は16件（文書だけの指摘2件、将来の潜在の経路だけの指摘1件を含む）。`finding-scope.js --from-snapshot` では、すべて差分の中で、変更外とした指摘はない。

- 読み直し（I-16-03）: 読込の時点で既知値を記録するため、読込の後・反映の前に排他区間に入った保存が照合を通り、古いメモリで上書きする。反映しなかったときは既知値だけが新しくなる。
- 読み直しに使う `loadAppDataFromStorage` は、保存値がないキーと停止中のキーで今のメモリを使うため、別のタブの全消去の後も古い内容が残り、保存し直す（E-16-04 と矛盾）。
- 起動中に届いた平文の通知で世代が進むと、起動側の読込が `STORAGE_SESSION_CHANGED` で失敗し、全キーを停止して安全な初期状態で起動する。起動と読み直しの直列化が決まっていない。
- 暗号化していないときも `cancelStorageAccess` が `lockStorage` を呼び、既知値が空になって照合が働かなくなる。
- 家庭情報入力の提出後の消去（`resetTransferForm`）が競合したときの結果が決まっていない（保存の結果を見ずに完了とする）。
- js/transfer.js の読込の関数を除くと失敗する試験（`tests/system/browser-runtime-evaluation.test.js`・`tests/unit/branch-coverage.test.js`）が一覧にない。
- `className` の代入が移し先のクラスを消す（パスワードの確認の表示。余白が変わる）。I-15-07 の操作の列も、I-15-06 のクラスの効果の試験も、これを検出しない。
- template の style 属性の実測が再現しない（移すと効かず、複製したときだけ効く）。注入の試料の期待値（CSP 違反なし）が成り立たない。
- Trusted Types で失敗する既存の試験（`tests/system/headless-csp-external.test.js` の script・object・Worker・`@font-face`・違反の判定、`tests/system/headless-security.test.js`、`tests/system/headless-workflows.test.js` の印刷の向き、`tests/unit/security-render-coverage.test.js`、`tests/system/csp-external-block.test.js` の js/hata.js の行の固定など）が一覧にない。Trusted Types のもとで、`script-src-elem`・`object-src`・`worker-src`・`script-src-attr` の検出力を何で保つかが決まっていない。
- カスケードレイヤーに対応しないブラウザでは `@import … layer(app)` が無効になり、css/base.css が読まれず、画面全体のスタイルが失われる。
- 許可リストの `class`・`id`・`data-` の操作名・`spellcheck` の値で、注入された要素が見た目と動作を変えうる（R-26 の「見た目や動作が変わらない」を満たせない）。
- Service Worker の登録の第1引数がポリシーの値であることを確かめる試験がない（退行すると HTTPS 配信のときだけ登録に失敗する）。
- 将来: `document.execCommand('insertHTML', …)`、`el.style` への文字列の代入、`Object.assign(el, { style })`、`setAttributeNS(null, 'style', …)`、属性のノードの値への代入が、固定する操作の一覧にない。
- 文書（2件）: ページの中で `innerHTML` に代入する実Chromium の試験の数（3か所）、Web Locks がないときの範囲の表現。

### 是正（まとめて直した。4.1 の 8.）

- I-16-01・I-16-03: 既知値を、読んだ時点ではなくメモリへの反映と同時に記録する。未暗号化の読込（js/crypto.js に新設）は、1つの排他区間の中で、読込・反映・既知値の記録・世代の前進を続けて行う（`commitImportedModel` と同じく、反映の後に世代を進める）。排他区間より先に入った古い保存は照合で、後に入った古い保存と取込は世代の判定で拒否する。保存値がないキーと読めないキーのモデルは既定値にする。起動も同じ読込で行い、起動中の通知は起動の後に1回だけ読み直す。起動時の `STORAGE_SESSION_CHANGED` は不正なデータとして扱わない。
- I-16-01: 既知値を空にするのは暗号化中のロックだけとし、暗号化していないときの `lockStorage`（`cancelStorageAccess` を含む）では空にしない。全消去は既知値を `null` にする。
- R-27・E-16-03・I-16-02: 提出後の消去は、保存が `false` なら「消去できませんでした」を表示して完了としない（別のタブの新しい内容を消さない）。
- I-15-05: 移し先のクラスを、カスケードレイヤーではなく、選択子に `:not(#_)` を3つ付けた詳細度 (3,1,0) で優先させる（ほかの規則の最大は (1,1,2)）。css/style.css は分けず、sw.js も変えない。パスワードの確認の表示は、状態のクラスだけを `classList` で替える。`className` の代入は作ったばかりの要素の3か所に固定する。I-15-07 の操作の列にパスワードの確認の表示を加えた。
	- 作業用の写し（比較元に移し替えのスクリプトと `classList` の改めを当てたもの）で、I-15-07 の比較（全要素の computed style、2つの画面幅、19の状態）を行い、差は0件だった。レイヤーの方式で比べたときも、差は `className` の代入による3つの要素だけだった。
- I-15-02・I-15-06: style 属性を取り除く理由を実測に合わせて直し（移すと効かないが、複製すると効く）、注入の試料の期待値を「style 属性の数だけの `style-src-attr` の違反だけ」とし、複製しても効かないことを加えた。`spellcheck` は値が `false` のものだけを残す。
- R-26・E-15-05・I-15-02: 描画の補助が残す `class`・`id`・`data-` による見た目の偽装・登録済みの処理の呼出し・参照先の奪取を、残余として書き、R-26 の目的を「スクリプトの実行・資源の読込・スタイルの適用・ページの移動・フォームの送信が起きない」に直した。
- I-15-06・I-15-08: Trusted Types で改める既存の試験を一覧に加えた。CSP の各指令の拒否は CDP の `DOM.setOuterHTML` で要素を入れて確かめ、`script-src-elem` は動的 `import()`、`worker-src` は CSP の文字列の固定で確かめる（Worker は Trusted Types のもとで構築できないことを確かめる）。
- I-15-06・追跡表: Service Worker の登録に渡す値の単体試験を加え、HTTPS 配信での登録を未検証として追跡表に書いた。
- I-16-07: js/transfer.js の読込の関数を使う試験を一覧に加えた。
- 将来の潜在の経路だけの指摘は、固定する操作と違反の試料に加えた（4.1 の 5.）。
- 文書だけの指摘は、あわせて直した（4.1 の 4.）。

---

## 2回目 — 要是正（Stage 2。要是正の2回目）

1回目の是正と、それが持ち込んだ問題を重点とした（4.1 の 7.）。指摘は14件（文書だけの指摘6件、将来の潜在の経路だけの指摘1件を含む）。`finding-scope.js --from-snapshot` では、すべて差分の中で、変更外とした指摘はない。

- 既定値を `clearMemoryAndDomForLock` の値にすると、起動時のモデルが比較元と変わる（代表の外部関係者が空、座席表の見出し、役員の役職、児童の既定の行）。保存値のない端末で起動して暗号化を設定すると、外部関係者の既定の6行が失われる。
- 未暗号化の読込に世代の判定がなく、読まなかったとき・例外のときの描き直しと案内が決まっていない（読んでいないのに案内を出しうる）。保留・予約した読み直しの暗号化の判定もない。
- 読み直しで、保存の拒否の状態（`storageSaveRejectedKeys`）を解除しない。
- 暗号化の設定の画面・引き継ぎの画面が開いているときの競合で、案内がモーダルの背後に出て、利用者には何も起きなかったように見える。
- 構築したスタイルシートに対応しない Firefox 96〜100・Safari 15.4〜16.3 で、旗振り表の横の印刷が退行する（R-26 と矛盾）。
- `tests/system/headless-csp-external.test.js` の `<style>` の中の `@import` の項目の改め方がない（`<style>` そのものが拒否され、構築したスタイルシートの `@import` は無視される）。
- `tests/system/headless-security.test.js` の CSP の試験は、Trusted Types のもとで `eval` が `script-src` の違反を出さず、インラインの script も TypeError になるため、待機の条件がそろわない。
- 将来: `style` の語の固定の「`.style.<プロパティ>`」に任意の名前が入り、`el.style.cssText = …`・`el.attributes.style.value = …` が許す形に当たる。
- 文書（6件）: `localStorage.clear()` の後は無効化の印で暗号化中として扱われること、Web Locks がないときの範囲（I-02）、設定の2つの呼出元の文言、クラスの効果の試験でスクリプトが設定済みのプロパティを上書きしないこと、js/transfer.js の児童のデータの `className` の代入、Service Worker の登録の分岐（http の `localhost`・`127.0.0.1` でも入る）。

### 是正（まとめて直した。4.1 の 8.）

- I-16-03: 既定値を、js/state.js の読込の時点の初期値の写しにし、起動時と同じ正規化を当てる（保存値のない起動のモデルは比較元と同じ）。`clearMemoryAndDomForLock` の値は使わない。
- I-16-03: 未暗号化の読込の結果を「読んだ」「読まなかった」（排他区間に入ったときに暗号化中）「例外」とし、排他区間に入ったときに呼出元の取った世代と今の世代を比べ、異なれば読まずに `STORAGE_SESSION_CHANGED` とした。描き直しと案内は「読んだ」ときだけ行う。世代の変化のときは読み直しを1回だけ予約する。保留・予約した読み直しも暗号化の判定を通す。反映で、4つのキーの保存の拒否の状態を解除する（`clearStorageSaveRejections`）。
- E-16-02・E-16-03・I-16-03: 読み直しは、まず設定の画面（`closeStorageSettingsModal`）と引き継ぎの画面（`clearBrowserHandoff`）を閉じる（暗号化中のロックと同じ）。
- R-26・E-15-02・I-15-05: 印刷の向きを、横向きの `@page` だけを持つ css/print-landscape.css の link（`media="not all"`）の `media` を、印刷の間だけ `print` にする方式に改めた（構築したスタイルシートは使わない）。sw.js の `ASSETS` に加える。
- I-15-06: `@import` は、試験の一時ディレクトリの一時のスタイルシートを link で読ませ、その中の外部の URL の `@import` の `style-src-elem` の拒否で確かめる。`tests/system/headless-security.test.js` は、`eval`・`new Function` の EvalError と `require-trusted-types-for` の違反、script の `textContent`・`setAttribute('onclick', …)` の TypeError、CDP で入れたイベント属性の `script-src-attr` で確かめ、インラインの script と `eval` の CSP の拒否は CSP の文字列の固定で確かめる。
- 将来の潜在の経路だけの指摘は、`style` の語の固定を `.style.display`・`.style.gridTemplateColumns` だけに限り、`el.style.cssText = …`・`el.style.color = …` を違反の試料に加えた（4.1 の 5.）。
- 文書だけの指摘は、あわせて直した（4.1 の 4.）。

---

## 3回目 — 要是正（Stage 2。要是正の3回目）

2回目の是正と、それが持ち込んだ問題を重点とした（4.1 の 7.）。指摘は7件（文書だけの指摘3件、将来の潜在の経路だけの指摘1件を含む）。`finding-scope.js --from-snapshot` では、すべて差分の中で、変更外とした指摘はない。

- 起動時の未暗号化の読込が、暗号化に関係しない世代の前進（設定の画面で暗号化の設定を送信してから閉じたときの `cancelStorageAccess` など）で `STORAGE_SESSION_CHANGED` になると、画面が描かれず既知値も記録されない。その後の平文の保存が照合なしで通り、保存済みのデータを初期値で上書きする（比較元では保存値のあるキーを停止していた）。
- 読み直しの「ほかの例外」で停止するキーが決まらない（例外のたびに読み直しが繰り返され、入力が黙って保存されない）。
- 読み直しが印刷の領域（`#print-area`）を空にせず、古い名簿がブラウザの印刷で出力されうる。
- 将来: `style` の語の固定が、`sheet.insertRule`・構築したスタイルシート（`replaceSync`・`adoptedStyleSheets`）・`document.styleSheets`・`el.attributeStyleMap` を検出しない。
- 文書（3件）: 移し先のクラスのファイルの構成の記述と印刷の向きの記述の矛盾、停止中のキーの保存値がなくなったときの再開、影響範囲の一覧の案内の要素・「閉じる」の処理・世代を進める関数（追跡表の実装の欄を含む）。

### 是正（まとめて直した。4.1 の 8.）

- I-16-01: 暗号化していないときは、既知値のないキーの保存・取込・復元・暗号化の設定を、照合の失敗と同じく拒否する（既知値がないのは、起動時の読込がまだ終わっていないときだけ）。
- I-16-03: 起動時の `STORAGE_SESSION_CHANGED` は、世代を取り直して読込をやり直す（「読んだ」か「読まなかった」で終わるまで）。起動時・読み直しのほかの例外は、保存値のあるキーの保存をすべて停止する（停止の警告が出る）。読み直しの「読んだ」ときに `#print-area` を空にする。
- 将来の潜在の経路だけの指摘は、スタイルの規則・宣言を文字列で作る API（`sheet.insertRule`・`sheet.replaceSync`・`CSSStyleSheet`・`document.adoptedStyleSheets`・`document.styleSheets`・`el.attributeStyleMap`）を0件に固定し、違反の試料に加えた（4.1 の 5.）。
- 文書だけの指摘は、あわせて直した（4.1 の 4.）。

### 指摘の傾向（要是正が3回続いたため利用者に報告。4.1 の 7.）

- 回ごとの指摘: 1回目16件（ゲートを止める指摘12件）、2回目14件（7件）、3回目7件（3件）。ゲートを止める指摘は回ごとに減っている。
- 種類: 1回目は設計の大きな欠け（読み直しの競合、Trusted Types で壊れる既存の試験、カスケードレイヤーに対応しないブラウザ、`className` の代入）。2回目は1回目の是正の帰結（既定値、読込の結果と世代、モーダルの背後の案内、古いブラウザでの印刷の向き、試験の改めの細部）。3回目は、未暗号化の読込と読み直しの端の場合（起動時の世代の前進、ほかの例外、印刷の領域）に集まっている。
- 根本の原因: BL-004 の読み直しは、既存のロック・処理の世代・暗号化への切替・設定の画面・起動の処理と交わる新しい並行の仕組みであり、直すたびに隣の場合が見えている。BL-003（描画の補助・スタイルの移し替え）の指摘は2回目で収束し、3回目は将来の潜在の経路だけだった。

### 判定

利用者の決定（「直して通過、残りは Gate 2・3 で」）により、3回目の是正をもって Gate 1 を通過とした。3回目の是正（未暗号化の読込と読み直しの端の場合、スタイルの API の固定）が正しいかは、Stage 4 の試験と Gate 2・Gate 3 で確かめる。Gate 2 の依頼文に、3回目の指摘と是正を示す。
