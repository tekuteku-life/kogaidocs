# 残件台帳（レビューの変更外の指摘・見送り・残余の作業）

**作成日**: 2026年11月22日<br>
**規則**: [開発プロセス定義書](development_process.md) 4.1 の 6.、4.7

ゲートで通過とした変更外の指摘（比較元と作業ツリーで同じ再現の結果になり、今回の変更による新しい経路もないもの）、利用者の決定で反映を見送った指摘、作業を要する未検証の境界・残余リスクを記録する。配信側（サーバー・ホスティング・HTTP 応答ヘッダー・TLS・公開の範囲）の設定に依存し、このリポジトリから制御できない事項は載せない（設計書の範囲外・前提として書く）。区分は「変更外／見送り／残余」、状態は「未対応（備考）／対応済み（コミット・記録）／見送り（理由）」とする。対応したときは状態を更新し、項目は消さない。

| ID | 記録日 | 出典 | 対象 | 内容 | 区分 | 状態 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| BL-001 | 2026-11-22 | [review90](reviews/review90_csp_verification.md) 第4節、E-14-03・E-14-05 | 実機・他のブラウザ | Microsoft Edge のテキスト予測の抑止（`writingsuggestions`）、Windows での file 起動（UNC パス）、実機 iOS/Android を確かめていない。 | 残余 | 未対応（実機での確認） |
| BL-002 | 2026-11-22 | [review86](reviews/review86_spec_q_verification.md) 第4節、E-13-02 | 旧版の出席の保存値 | 旧版の出席セレクタが名簿の異なる同名エントリへ行番号で同期して保存した値は区別できず、照合（印刷対象の切替など）や取込で代表名簿と一致しなければ解除されるまで、保存値に残りうる。 | 残余 | 見送り（区別する手段がない） |
| BL-003 | 2026-11-22 | [review78](reviews/review78_test_security_assessment.md)・[review82](reviews/review82_verification.md) R-SEC-A | 描画部の CSP | `style-src 'unsafe-inline'` と Trusted Types が未導入。生成する画面・印刷の style 属性と `<style>` 要素を使うため、導入には描画部の改修を要する。 | 残余 | 未対応（描画部の改修を要する） |
| BL-004 | 2026-11-22 | [review82](reviews/review82_verification.md) R-SEC-C | 未暗号化のゲストデータ | 未暗号化のゲストデータの他タブ競合（他タブの保存で古い値に戻りうる）。 | 残余 | 未対応 |
| BL-005 | 2026-11-22 | [review82](reviews/review82_verification.md) 未検証境界（配信側の TLS を除く）、[追跡表](specification_traceability.md) E-08-04 | 実機・OS の機能 | 実WebAuthn認証器と、OS のファイル選択・印刷・共有・クリップボード履歴の実配送を確かめていない（WebAuthn は API の fixture で試験している）。 | 残余 | 未対応（実機での確認） |
| BL-006 | 2026-11-22 | [review91](reviews/review91_process_tools_gate1.md) 1回目・2回目の是正（`check-docs.js --base` の初回の実行） | external_design.md:106、internal_design.md:488・490・497 | 設計書の逆引用符の中の識別子 `selectedSummary`・`setActiveAppMode`・`saveFn`・`usedPrompt` が、コード（js・sw.js のコメントを除くコード、index.html、tests/ の文字列・コメントを除くコード）にない（`saveFn` は `performAppUpdate` の保存の組の説明で、コードでは `fn`）。再現手順: `node tests/scripts/check-docs.js --base ee512ac` が比較元の木と作業ツリーの両方でこの4件を出し、「変更外」と分けることを確かめた（両方で同じ結果）。新しい経路の確認: 今回の作業は設計書3文書と js/・sw.js・index.html を変えていない。[review91](reviews/review91_process_tools_gate1.md) 3回目のレビュワーも判定を確かめた。 | 変更外 | 未対応（設計書の記述を今の名前に合わせる） |
| BL-007 | 2026-11-22 | [review91](reviews/review91_process_tools_gate1.md) 1回目の是正（`precheck.js` の初回の実行） | js/state.js:234、js/transfer.js:240 | トップレベルの関数 `saveTransferLocal` が2つのファイルで宣言されている（index.html の読込みの順で後の js/transfer.js の宣言が使われる）。再現手順: `node tests/scripts/precheck.js --base ee512ac` が、比較元と作業ツリーの両方で同じ2件の宣言（js/state.js:234・js/transfer.js:240。宣言のファイル・件数・本文が同じ）を出し、「変更外」と分ける（両方で同じ結果）。新しい経路の確認: `finding-scope.js --base ee512ac` の「呼出元の変更」は、両方の参照で「なし」（今回の作業は js/・index.html を変えていない）。[review91](reviews/review91_process_tools_gate1.md) 3回目のレビュワーも判定を確かめた。 | 変更外 | 未対応（どちらかに統一する） |
| BL-008 | 2026-11-22 | [review92](reviews/review92_process_tools_gate2.md) 1回目の是正（利用者の決定） | 開発プロセス定義書 Stage 4・Stage 7 の「単位ごとの実行と記録」 | 一掃と変異の当て込みを単位ごとに実行し、入力の SHA-256 と結果を記録して、不合格の単位と入力が変わった単位だけをやり直す仕組み（`run-units.js` と、実行の間に読んだファイルを記録する `trace-reads.js`。review92 の2回目の是正で加えた）は、作業用のフォルダに置いて使っており、リポジトリの `tests/scripts/` に入れていない（入れると、このスクリプト自体も試験・変異・ゲートの対象になるため、今回の作業では見送った）。 | 残余 | 未対応（tests/scripts への追加と試験） |
