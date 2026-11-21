# Gate 2 テスト観点網羅性レビュー記録（1回目）

**実施日**: 2026年11月19日<br>
**レビュワー**: 独立サブエージェント（Gate 2 Test Coverage Reviewer、読取専用、設計レビュワーとは別個体）<br>
**対象**: 本番コード変更前（TDD Red）の `tests/unit/security-save-invariant.test.js`、`tests/unit/handoff-guest-preserve.test.js`、`tests/unit/import-output-hardening.test.js`、`tests/system/headless-save-invariant.test.js`、および既存テストの変更・新設計との矛盾<br>
**判定**: **要是正（手戻り：Stage 4へ差し戻し、仕様未定義4件は Stage 2 へ）**

---

指摘は42件である。区分ごとの要旨と是正方針を記録する（指摘原文の `<ファイル>:<行>` は是正前の行番号）。

| 区分 | 指摘の要旨 | 是正方針 |
| :--- | :--- | :--- |
| 仕様との矛盾 | `security-save-invariant.test.js:152-153` の姓なし8193文字 `name` 受理と境界、`:266` の不合格メモリでの暗号化設定、`import-output-hardening.test.js:158` の家庭情報学年のエラー種別、`:314` の1行4096文字超過入力、`headless-save-invariant.test.js:47` の通知文言、`:94` の要件ID誤り | 承認済み仕様に合わせて期待値・入力を修正する |
| 仕様未定義 | `:258` ロック・全消去時の警告非表示、`:309` 停止中キーへの部分合成のエラー種別、`:387` `describeUnlockFailure` の引数、`:449` 自動生成失敗の文言 | I-12-02・I-12-07・I-12-08・I-12-15 に明記する（Gate 1 差分確認） |
| 不足観点 | 保存値不変の確認（`:188`）、`addNeighborhoodRow`・`addNewRepDistrict` の取消（`:179`・`:210`）、静的HTMLの要素（`:220`）、停止中の更新・引き継ぎ復元・実呼出元（`:308`）、修復の境界と形式移行（`:356`）、生体認証の実経路（`:377`・`:520`）、既存下書きの不変（`:449`）、排他待ち中の割込み（`:486`）、自タブ書込み後の誤ロック（`:533`）、厳密な通知回数（`:570`）、取込・引き継ぎ復元の呼出元表示（`:666`）、鍵導出中のメモリ変更と鍵生成不呼出し（`:691`）、未暗号化端末のゲスト復元と `replacedKeys`（`handoff-guest-preserve.test.js:72`）、版1空欄の統合結果（`import-output-hardening.test.js:161`）、貼付・代表UI経路（`:123`）、代表ファイルの記憶パスワード（`:78`）、全出力の日付（`:269`）、旧別名の正式キー優先・作成日優先（`:284`）、実Chromiumの警告要素・長い派生値・保存待機中の割込み・ゲスト案内・引き継ぎ下書き拒否（`headless-save-invariant.test.js:44`・`:37`・`:84`・`:143`）、固定待機（`:66`） | 各テストを追加・強化する |
| 弱い assertion | `hata.test.js:680` の OR 判定、`:692` の `printed <= 1` | 期待値を一意に定める |
| 既存テストの矛盾 | `security-state.test.js:672`（有効な他タブ書込みで非ロック）、`utils.test.js:503`（免除キー4097拒否）・`:526`（`refKey` 4097拒否）、`security-date-boundary.test.js:144`・`158-162`・`204`（旗振り予算超過の読込拒否）、`security-import-lifecycle.test.js:111-130`（不正日付の保存・読込拒否）、`headless-saved-data-audit.test.js:100`（10001件名簿の読込拒否） | 承認済み設計（I-12-03・05・06）に沿って、修復結果の期待と修復不能値の拒否に分けて更新する |

---

## Gate 2 再レビュー結果（2回目・要是正）

- tests/unit/security-save-invariant.test.js:23: `fresh()` が `setupDomEnvironment()` 後に `global.URL` を戻さず、`MockURL` の自己参照で `app.switchTab`・`handoff.openBrowserHandoff` が無限再帰となり、SEC-34 の6テストが実装の有無にかかわらず失敗する。`global.URL = require('node:url').URL` を設定すること。
- tests/unit/security-save-invariant.test.js:376: I-12-02「集合が空なら警告を隠す」と I-12-07 の停止中警告が矛盾し、別キーの保存成功で停止中の警告が消える。仕様に「停止中のキーがある間は警告を消さない」と明記し、検査を追加すること。
- tests/unit/security-save-invariant.test.js:330: 静的HTMLの正規表現が要素名と属性順に依存する。開始タグを取り出し `id`・`role="alert"`・`hidden` を独立に検査すること。
- tests/system/headless-save-invariant.test.js:114: 第2コンテキストが排他ロック保持中に `loadStorageDecrypted()`（共有ロック要求）を呼びデッドロックする。`loadStorageDecryptedUnlocked()` を使い、`{}` を書く代替経路を削除すること。
- tests/unit/security-date-boundary.test.js:163: 形式1では `activateStorageKey` が修復済み値を再暗号化して書くため `loadAppDataFromStorage` の `repairs` が空になり、旧形式端末で修復通知が出ない設計の欠落でもある。`activateStorageKey` の修復結果を引き継ぐことを明記し、旧形式端末の解除で通知が1回出る検査を追加すること。
- tests/unit/security-import-lifecycle.test.js:107: 修復を検査する経路のテスト名が「refuses」のままである。経路ごとに名前を分けること。

---

## Gate 2 再レビュー結果（3回目・PASS）

PASS

---

## Gate 2 差分確認（4回目・PASS）

PASS

**最終判定**: 合格（3回目で PASS、その後に Gate 1 の明確化で追加した2検査も4回目で PASS）。

---

## Gate 2 差分確認（5回目・要是正、PASS 後の追加テスト・フィクスチャ修正）

- tests/unit/save-invariant-coverage.test.js:40: 予期しない読込例外を保存値が空の端末でしか検査しておらず、保存値がある端末で停止されないまま既定状態の自動保存が平文の原本を上書きできる経路（js/app.js:1071-1076）を検出できない。扱いを I-12-07 に明記し、原本不変（または停止）を検査すること。
- tests/unit/save-invariant-coverage.test.js:150: 「第3引数はオブジェクトだけを受け付ける」の異常系がなく、旧シグネチャの `true` で検証を飛ばす実装でも合格する。
- tests/unit/handoff-guest-preserve.test.js:187: 復元中にダイアログを閉じた場合の保存値・`transferState` の不変を検査していない。

---

## Gate 2 差分確認（6回目・PASS）

PASS
