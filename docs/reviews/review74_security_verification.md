# 追加セキュリティアセスメント改修の実装・検証記録（v2.11.1 / SEC-25〜SEC-29）

- 対象バージョン: `2.11.1`
- 作業ブランチ: `fix/security-assessment-hardening`（起点コミット `f2a8107` / `main`）
- 実施日: `2026-11-18`
- 記録者: 実装担当（独立 Gate 3 レビューは [review75](review75_security_final_gate3.md) に別途記録）

## 1. 指摘事項と是正内容（SEC-25〜SEC-29）

| 指摘ID | 要件・設計対応 | 主な修正箇所 | 検証内容 |
| --- | --- | --- | --- |
| SEC-25 | R-20 / E-10-06 / I-10 | `js/app.js`, `js/crypto.js`, `js/handoff.js` | 未暗号化端末でのゲスト専用引き継ぎ作成（役員モデル・役員下書き除外）と `performAppUpdate` 許容、未暗号化先での役員データ引き継ぎ拒否（`STORAGE_ENCRYPTION_REQUIRED`）、`I-10` 既定テンプレート判定（`szExternals` の既定メタキー以外の全所有キー `kana`/`note`/`email` 等を含む検査・`hasOfficerData` / `hasNonEmptyOfficerModels` / `hasOfficerHandoffData`）、`resolveCurrentHandoffMode()` による `getActiveAppMode()` 優先。 |
| SEC-26 | R-20 / E-10-07 / I-10 | `js/app.js`, `js/crypto.js`, `js/handoff.js` | ロック時ワンクリック暗号設定の解除モーダル誘導、`d-pass`/`rep-pass`/`neighbor-pass` 空欄・不在時の `inputId` 文字列フォールバック禁止、新規・解除済み双方での `rep-pass`/`neighbor-pass` による地区保存パスワード非汚染、`beginStorageAccess()` / `guard()` / 新規設定後 `persistDistrictCardPassword()` 結果とセッション維持確認 / `handleAddOrUpdateBiometric` の `epoch`/`generation`/`!isStorageUnlocked()` 照合および閉鎖・ロック・認証情報消去後（PRF 完了・`NotAllowedError` 等拒否双方）の無通知中断、`prfResult` ゼロ化、`meta.webauthn` 非 null 検証、`parseTxtContent` 内世代検証、`restoreBrowserHandoff` 全ドラフト・秘密情報消去。 |
| SEC-27 | R-20 / E-10-08 / I-10 | `js/rep.js`, `js/district.js`, `js/neighbor.js`, `js/transfer.js`, `js/hata.js`, `js/print.js` | 全14取込入口での `assertStorageSession`（`loadHataOfficialFile` でのファイル読込直後判定を含む）および `STORAGE_SESSION_CHANGED` 無言中断（再入力・再描画・アラート抑止）、クリップボード出力・`exportSingleDistrictFromRep` のロック後通知・フォールバック抑止とカード入力時確認パスワード照合（null ガード付き）・2000文字超退避、役員系印刷のロック遮断（事前・連続印刷ループ内・事後 `#print-area` 消去）と自治会系印刷のロック時継続（`E-10-01`）。 |
| SEC-28 | R-20 / E-10-09 / I-10 | `js/utils.js`, `js/app.js`, `js/district.js`, `js/rep.js`, `js/neighbor.js`, `js/transfer.js`, `js/handoff.js` | `resetPasswordInputs()` による対象パスワード欄・可視化トグル・5種のパスワード判定メッセージのみの一括初期化（`null` 指定時の即時returnによる他タブ・他モーダル非干渉、`#rep-new-district-error` 明示維持）、およびロック・年度更新・リセット・読込・引き継ぎ復元での `#hata-line-text`・`#print-area` 消去（各 DOM 参照の `null` ガード・`hideStorageUnlockModal` の `if (modal)` 内実行を含む）。 |
| SEC-29 | R-20 / E-10-10 / I-10 | `index.html`, `sw.js`, `js/utils.js`, `js/crypto.js`, `js/app.js`, `js/district.js`, `js/neighbor.js`, `js/rep.js` | 旗振り（複数行 `specials` 除外）・座席表・転入メモの 4096 文字上限と `#hata-*`/`#rep-new-district-name`/動的 `tel`/`email` への `maxlength="4096"` 付与、`saveAndCloseRepDistrictDetailModal` の `validateImportData('rep')` 検査、`loadStorageDecryptedUnlocked` 順の維持、他タブでの `STORAGE_DATA_KEYS` 改竄・欠損・ダウングレード検知、`isNewerVersion` 厳格化、`credentials: 'omit'`、SW `message` 送信元オリジン・スコープ検証。 |

### Gate 3 指摘事項の是正履歴

- **初回監査（会話 `d51da35c-e669-47ad-9416-a4bf42d8e443`、8件）**:
  1. `js/app.js` `quickSetupEncryptionFromCard`: 既知カード入力 ID（`d-pass`, `rep-pass`, `neighbor-pass`）が空文字または要素不在のとき `inputId` 文字列自体をパスワードへ流用しないようガード。
  2. `js/app.js` `quickSetupEncryptionFromCard`: 新規暗号設定後の `persistDistrictCardPassword(password)` 実行中も `storageAccessBusy` を維持し、保存失敗・中断・ロック時はバッジ更新・タイマー更新・完了通知を抑止。
  3. `js/crypto.js` `hasOfficerData`: `szExternals` 既定6行テンプレート検査を既定4キー（`attend`, `category`, `org`, `role`）以外の全所有キー（`kana`, `note`, `email` 等）検査へ拡張。
  4. `js/hata.js` `loadHataOfficialFile`: `await readImportFile(file)` 直後に `assertStorageSession(generation)` を追加し、読込待機中ロック時の空ファイル・不正 JSON エラー `alert` を抑止。
  5. `js/app.js`, `js/district.js`, `js/rep.js`: `#hata-line-text` / `#print-area` / `#rep-pass-confirm` に対する `null` ガードを復旧し、`security-state.test.js` に要素不在シナリオテストを追加。
- **再監査（会話 `5271dbda-8f39-4c4d-9607-94a96affe26b`、4件）**:
  6. `js/app.js` `handleAddOrUpdateBiometric`: `guard()` に `!isStorageUnlocked()` 照合を追加し、`I-10` に準拠。
  7. `js/app.js` `handleAddOrUpdateBiometric`: `catch` 内で `!isCurrent()`（`epoch !== storageAccessEpoch || generation !== getStorageSessionGeneration() || !isStorageUnlocked()`）を判定し、中断後の `NotAllowedError` 等の拒否例外でも `alert` を抑止して `false` を返却（`security-output-lifecycle.test.js` に認証削除・拒否経路を追加）。
  8. `js/utils.js` `resetPasswordInputs`: 明示的 `null` 引数時の `document` 昇格を廃し `if (!root || typeof document === 'undefined') return;` へ変更。
  9. `js/app.js` `hideStorageUnlockModal`: `resetPasswordInputs(modal)` を `if (modal)` ブロック内へ移動し、`#storage-lock-modal` 不在時の他タブ干渉を防止（`security-state.test.js` に `null` 引数・不在モーダル試験を追加）。

## 2. Stage 7・Stage 8 固定コード検証結果

コード凍結後に実施した全機械検査およびテストスイートの結果は以下の通りである（すべて終了コード 0、失敗・スキップ 0 件）。

| 検証項目 | コマンド | 結果 |
| --- | --- | --- |
| 構文チェック・差分空白検査 | `find js tests -name '*.js' -print0 \| xargs -0 -n1 node --check && node --check sw.js && git diff --check` | 成功（終了コード 0、エラー・空白違反なし） |
| 静的解析・バージョン整合性 | `node --test tests/system/static-analysis.test.js tests/unit/version-consistency.test.js` | `6/6` 件成功（fail 0、skip 0、`2.11.1` SSOT 整合） |
| 全自動テストスイート + カバレッジ | `npm test` | `874/874` 件成功（pass `874`, fail `0`, cancelled `0`, skipped `0`, `201483ms`） |
| ヘッドレス Chrome UI テスト一式 | `npm run test:ui` | `189/189` 件成功（pass `189`, fail `0`, cancelled `0`, skipped `0`, `138460ms`） |

### 本番 13 モジュール カバレッジ実績（`npm test` 計測値）

全 13 モジュールで **Line 100.00%** および **Branch 95.00% 以上**（範囲 `95.09% 〜 99.43%`）を達成した。

| ファイル | Line % | Branch % | Funcs % | 未到達行 |
| --- | ---: | ---: | ---: | --- |
| `js/app.js` | 100.00 | 95.17 | 100.00 | - |
| `js/crypto.js` | 100.00 | 95.40 | 97.25 | - |
| `js/district.js` | 100.00 | 95.57 | 100.00 | - |
| `js/events.js` | 100.00 | 98.64 | 99.29 | - |
| `js/handoff.js` | 100.00 | 95.10 | 100.00 | - |
| `js/hata.js` | 100.00 | 95.25 | 97.26 | - |
| `js/neighbor.js` | 100.00 | 96.83 | 100.00 | - |
| `js/print.js` | 100.00 | 99.43 | 100.00 | - |
| `js/rep.js` | 100.00 | 95.09 | 100.00 | - |
| `js/seat.js` | 100.00 | 96.84 | 100.00 | - |
| `js/state.js` | 100.00 | 98.32 | 100.00 | - |
| `js/transfer.js` | 100.00 | 97.50 | 100.00 | - |
| `js/utils.js` | 100.00 | 98.19 | 98.82 | - |
| `all files`（テスト補助含む全体） | 98.32 | 95.83 | 98.17 | `tests/helpers/*`, `tests/system/helpers/*` のみ |

## 3. テスト境界と未確認領域

- ヘッドレス Chrome UI テストでは実 Chromium・実 DOM・実 WebCrypto を用いているが、`window.print`・`navigator.clipboard`・ダウンロード・`navigator.credentials`・SW 実 HTTP 更新配信（オフライン HTTP 手動試験 `tests/manual/offline-http.js` 対象）はテストハーネスまたは Node 側モックによる境界検証である。
- 実 HTTPS 配信環境および実機スマートフォン（iOS Safari / Android Chrome）の生体認証 PRF 動作・OS 印刷プレビュー・OS クリップボード履歴挙動は本自動スイートの対象外である。
