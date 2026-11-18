# Gate 1 設計・セキュリティアセスメントレビュー記録 (1回目)

**実施日時**: 2026年11月17日<br>
**レビュワー**: 独立サブエージェント (`Gate 1 QA & Security Lead Reviewer`)<br>
**判定**: **要是正（手戻り：Stage 2へ差し戻し）**

---

- docs/internal_design.md:484: `hasOfficerData(modelKey, value)` / `hasNonEmptyOfficerModels(models)` / `hasOfficerHandoffData(payload)` における未編集既定値と変更値の境界が未定義。`js/state.js:50-66` の `repState.szExternals`（6件の既定テンプレート）と `repState.seatConfig`（`topLabel: '前方（演台・司会・スクリーン側）'` 等）、`js/app.js:657-675`（`officers[0].role: '校外委員'`、`seatConfig.topLabel: '前方'`）、`js/app.js:851-853`（空の `neighborhood[0].role: '会長'`、`students[0]` の `grade: '6', class: '1'`）、`js/hata.js:780-858` の自動補完 `hata`（`createdDate`, `holidays`, `startDate`, `endDate`, `title`, `time`, `headerMsg`, `footerMsg` 等）を未編集既定値として扱う基準を明記しないと、暗号化端末のゲスト引き継ぎが誤拒否されるか、`szExternals[i].attend` / `org` / `role` / 行削除や `seatConfig.cols` / `rows` / `topLabel` / `cells` 改変を見逃す。また `kogai_district_v2` 判定に旧互換キー `officer`・`hatafurotto`・`savedFilePassword`・`szNeighborChecks`・`selectedForPrint === false` を含める必要がある。
- docs/internal_design.md:485: `collectBrowserHandoff()` のモード判定が `localStorage.getItem('kogai_active_mode')`（`js/handoff.js:77`）のみだと他タブ書換えや未保存時に役員モードをゲスト扱いする恐れがあるため、`activeAppMode` が設定されていれば優先して `'district'` / `'rep'` を拒否する必要がある。またゲスト引き継ぎ時に `payload.drafts` を `'neighbor-paste-box'` のみとした場合、`restoreBrowserHandoff()`（`js/handoff.js:189`）の `Object.entries(payload.drafts)` 更新だけでは既存の `HANDOFF_DRAFT_IDS`（`d-paste-box` や `rep-new-district-name` 等）が残留するため、全 `HANDOFF_DRAFT_IDS` を走査して未含有キーを `''` で初期化する必要がある。
- docs/internal_design.md:486: `replaceStoredAppData(models, guard)`（`js/crypto.js:816`）は `models` のみを受け取り `payload.mode` / `payload.repDraft` / `payload.drafts` を参照できないため、`restoreBrowserHandoff()`（`js/handoff.js:169-175`）で `confirm()` および `replaceStoredAppData()` の前に `officerPlaintextWriteDenied('kogai_district_v2') && hasOfficerHandoffData(payload)` を検証して `STORAGE_ENCRYPTION_REQUIRED` を送出し、さらに `replaceStoredAppData()` の `withStorageLock('exclusive', ...)` 内部で `officerPlaintextWriteDenied('kogai_district_v2')` と `hasNonEmptyOfficerModels(values)` を再評価する必要がある。
- docs/internal_design.md:487: `performAppUpdate(targetVersion)`（`js/app.js:1040-1055`）で `[saveDistFn, saveRepFn, saveNeighborFn, saveTransferFn].filter(...)` 後に添字で `STORAGE_DATA_KEYS[index]` を参照すると一部関数欠落時にキー対応がずれるため、`[['kogai_district_v2', saveDistFn], ['kogai_rep_v2', saveRepFn], ['kogai_neighbor_v2', saveNeighborFn], ['kogai_transfer_v2', saveTransferFn]]` の組で扱い、さらに保存前後の `getStorageSessionGeneration()` と `isStorageEncrypted()` 一致を検査してロック待機中の世代変更を許容しないよう修正する必要がある。
- docs/external_design.md:178: E-10-07 の「既に解除済み時の自治会・代表からの呼び出しで地区側記憶パスワード等を汚染しない」に加え、未暗号化からの新規設定時も同様に `neighbor-pass` / `rep-pass` が地区側記憶パスワード等を汚染しない仕様とすべきである（`docs/reviews/review71_security_assessment.md:31` も同様）。
- docs/internal_design.md:489: `quickSetupEncryptionFromCard(inputId)`（`js/app.js:787-830`）について、解除済み分岐だけでなく新規設定分岐（`!isStorageEncrypted()`、`js/app.js:817-822`）でも `inputId === 'neighbor-pass' || inputId === 'rep-pass'` の場合は `currentDistrict.savedFilePassword`・`#d-save-password-optin.checked`・`#d-pass.value` へ設定せず `saveDistrictLocal()` による地区側汚染を防ぐ必要がある。また解除済み時の `await saveDistrictLocal()` が `false` を返した場合は記憶完了 `alert` を出さず失敗を返すべきである。
- docs/internal_design.md:490: `handleAddOrUpdateBiometric()`（`js/app.js:638-646`）に `beginStorageAccess()`（`storageAccessBusy = true`）を用いると、登録中に設定モーダルを閉じるまたはタブ切替する（`closeStorageSettingsModal()` -> `cancelStorageAccess()`）と `js/app.js:15-19` の `if (storageAccessBusy)` が発火し、既に解除済みのセッションを `lockStorage()`・`clearMemoryAndDomForLock()` で破壊しバッジ／ゲート表示と不整合を起こす。`storageAccessBusy` を立てずに `storageAccessEpoch`・`getStorageSessionGeneration()`・`isStorageUnlocked()` を照合する専用 `guard` を `registerWebAuthnForActiveKey(guard)` へ渡す設計へ修正する必要がある。
- docs/internal_design.md:491: `zeroBuffer(buffer)`（`js/crypto.js`）で `new Uint8Array(prfResult).fill(0)` とすると、モックやポリフィルが返す `Uint8Array`（`ArrayBufferView`）に対して新規コピーが生成され元の `prfResult` バッファがゼロ化されない。`ArrayBuffer.isView(buffer)` 時は `new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).fill(0)`、`buffer instanceof ArrayBuffer` 時は `new Uint8Array(buffer).fill(0)` を実行する仕様とすべきである。
- docs/internal_design.md:493: インポート処理の対象に `loadHataOfficialFile(event)`（`js/hata.js:512-533`）が欠落しており、同関数冒頭の `assertStorageSession(generation)` 追加および `catch` での `STORAGE_SESSION_CHANGED`（または `!isStorageUnlocked() || generation !== getStorageSessionGeneration()`）判定による `alert` 抑止を明記する必要がある。また `loadMultipleDistrictFiles(e)`（`js/rep.js:150-169`）は `STORAGE_SESSION_CHANGED` 捕捉時にファイルループ・`renderRepAll()`・`alert()` を継続せず `e.target.value = ''` のみ行って即時終了すべきである。
- docs/external_design.md:179: E-10-08（および `docs/internal_design.md:494`）の「代表切り出し出力でも確認パスワード不一致を検証」について、`exportSingleDistrictFromRep(index, explicitPass, explicitMode)`（`js/rep.js:1046-1084`）で無条件に `#rep-pass-confirm` 一致を強制すると `explicitPass` 引数指定時および `#rep-pass` 空欄からの `safePrompt` 入力時に失敗するため、`!explicitPass && !usedPrompt`（`#rep-pass` 由来時）に限定すべきである。また印刷停止条件について、役員系印刷（`printSingleDistrictSelected`, `printSingleDistrictSeparately`, `executeRepSelectedPrint`, `printHataSchedule`）は `outputIsCurrent()` と `!(isStorageEncrypted() && !isStorageUnlocked())` を要求する一方、`printNeighborRoster`・`printNeighborTentCards`（`js/neighbor.js:306-352`）は E-10-01 のロック中メモリ入力印刷を維持するため `outputIsCurrent()` のみで判定し、全印刷関数で `window.print()` 後に `!outputIsCurrent()` なら `#print-area` を空にすべきである。
- docs/internal_design.md:496: ① `E-10-09`（`docs/external_design.md:180`）と一致させるため、`#hata-line-text` の空・非表示化をロック時だけでなく `runDistrictYearUpdate()`・`restoreBrowserHandoff()`・`loadDistrictTxt()` にも適用し、`#print-area` 消去およびパスワード欄リセットを `runRepYearUpdate()`・`runNeighborYearUpdate()`・`clearAllRepDistricts()`（`#print-area` のみ）にも適用する必要がある。② `hideStorageUnlockModal()`（`js/app.js:321-327`）でも `resetPasswordInputs` を呼び `#storage-lock-modal` 内の `.btn-toggle-pass` を `'👁️'` に戻すべきである。③ `resetPasswordInputs(root)`（`js/utils.js`）は `tests/helpers/dom-mock.js:199-224` が複合・子孫セレクタや `.pass-input-group` 包含を模擬しないため、対象パスワード入力ID・トグルボタン・`*-pass-match-msg` ID の直接参照も併用する必要がある。
- docs/internal_design.md:498: `validateHataConfig(config)`（`js/utils.js:608-609`）の `strings` 配列には複数行文字列の `specials`（E-02-12 により1行4,096文字以下・最大10,000行・1MiB以下）が含まれるため、`specials` を合計4,096文字上限から除外し、単一行・メタ文字列群・`format`・`exemptHouseholds` 要素・`manualOverrides` キーと各文字列項目・`schedule` 各文字列項目・`holidays` 配列 `name` のみに `<= 4096` を適用する仕様とすべきである。
- index.html:1079: `#rep-new-district-name` に `maxlength="4096"` と `maxlength="50"` の属性が重複しているため、`maxlength="50"` を削除して `maxlength="4096"` に統一する必要がある。
- docs/internal_design.md:500: ① `loadStorageDecryptedUnlocked(storageKey)`（`js/crypto.js:843-861`）は `!isStorageEncrypted()` 分岐後に `if (!activeStorageSessionIsCurrent()) throw new Error('STORAGE_LOCKED')` を評価し、その後に `STORAGE_DATA_KEYS.includes(storageKey)` 対象の `!raw` を `STORAGE_DATA_MISSING` として拒否すべきである（ロック中に欠損エラーを先行させない）。② `initAutoLockListeners()`（`js/app.js:754-760`）は `!isStorageEncrypted()` 時には `STORAGE_DATA_KEYS` の `storage` イベントへ反応させず（未暗号化時のゲスト保存で `invalidateStorageSecurity()` を誤発火させないため）、暗号化中のみ `event.newValue == null || typeof event.newValue !== 'string' || !event.newValue.startsWith('STORAGE_ENC:') || (meta?.storageFormat === 2 && !event.newValue.startsWith('STORAGE_ENC:2:'))` を削除・平文降格・旧形式降格として即時ロックすべきである。
- docs/external_design.md:181: E-10-10（および `docs/internal_design.md:501`）について、`sw.js:80-84` の `message` リスナーは別オリジンだけでなく同一オリジン別スコープからのメッセージも拒否するため、`event.origin === SCOPE_ORIGIN` に加え `event.source?.url` を `new URL(...)` で検証し、`SCOPE_PREFIX = CACHE_SCOPE.endsWith('/') ? CACHE_SCOPE : CACHE_SCOPE + '/'` を用いて `sourceUrl.origin === SCOPE_ORIGIN && (sourceUrl.href === CACHE_SCOPE || sourceUrl.href.startsWith(SCOPE_PREFIX))` を満たさない場合（`MessagePort` 等で `event.source?.url` が存在しない場合を含む）を拒否する設計とすべきである。


---

## Gate 1 再レビュー結果（2回目・要是正）

- `docs/internal_design.md:485`: `hasOfficerData('kogai_district_v2', value)` の項目名を実在スキーマ（`district`, `han`/`hanList`, `szNeighborChecks` 等）と空既定境界へ修正。
- `docs/internal_design.md:486`: `hasOfficerData('kogai_rep_v2', value)` の `seatConfig` 既定 `cols` を `4`、`szExternals` 既定（6件テンプレートの `attend: true` 及び実フィールド、かつ `length === 0` も空扱い）へ修正。
- `docs/internal_design.md:487`: 実在役員系下書き6ID（`d-paste-box`, `d-neighbor-paste-box`, `d-transfer-paste-box`, `rep-paste-box`, `rep-transfer-paste-box`, `rep-new-district-name`）へ修正。
- `docs/internal_design.md:488`: `js/app.js` から `getActiveAppMode()` を公開して優先参照する設計を追加。
- `docs/internal_design.md:492`: `quickSetupEncryptionFromCard` 判定を `!['neighbor-pass', 'rep-pass'].includes(inputId)` へ変更。
- `docs/internal_design.md:494`: `meta.webauthn != null` 時限定検証、および `zeroBuffer` 導入に伴う共有モックの独立コピー返却化を追記。
- `docs/internal_design.md:496`: 非存在 `loadTransferTxt` 削除、実在5関数（`loadTransferFileIntoDistrict` 等）追加。
- `docs/internal_design.md:497`: `copyHataForLine` の `#hata-line-text` 代入前セッション・ロック検証を追記。
- `docs/external_design.md:179` / `docs/internal_design.md:498` / `docs/reviews/review71_security_assessment.md:32`: 「家庭情報入力印刷」を「自治会印刷」へ是正。
- `docs/internal_design.md:500`: `resetPasswordInputs(root)` の `root.id` 毎ID表と `data-password-target` 照合設計を具体化。
- `docs/external_design.md:181` / `docs/internal_design.md:503` / `docs/reviews/review71_security_assessment.md:34`: `validateHataConfig`（`specials` 除外）と `validateHataTextBudget`（`specials`/文字列`holidays`/`members`）の役割分離を明確化。
- `docs/internal_design.md:505`: `js/crypto.js` からの `STORAGE_DATA_KEYS` エクスポートを追加。
- `docs/internal_design.md:506`: `isNewerVersion` の先頭1文字 `'v'` 除去と `sw.js` `SCOPE_PREFIX`・`try/catch` 検証を追記。
- `docs/specification_traceability.md:352`: 新規設定時（`!isStorageEncrypted()`）の `neighbor-pass`/`rep-pass` 非汚染観点を追加。


---

## Gate 1 再レビュー結果（3回目・要是正）

- `docs/internal_design.md:485`: 実在しない `officers[].mail`・`hata.lastGenerated` を削除し、`hanList`（1件以上の非空要素）、`hata.members`、別名キー10種（`scheduleTitle`, `metaCreatedDate`, `scheduleCreatedDate`, `metaLocation`, `metaTime`, `metaHeaderMsg`, `metaFooterMsg`, `metaContactMsg`, `metaOrientation`, `metaLayoutColumns`）および `createdDate`/`startDate`/`endDate`/`holidays`/`title`/`headerMsg`/`footerMsg`/`format` の初期自動補完境界を明確化。
- `docs/internal_design.md:486`: `kogai_rep_v2.seatConfig` の `leftSide`/`rightSide`/`topLabel`/`bottomLabel` について `undefined`・空文字も未編集既定として許容。
- `docs/internal_design.md:492`: `quickSetupEncryptionFromCard` の新規設定時（`!isStorageEncrypted()`）における `setupStorageEncryption`・`updateSecurityBadge`・`updateOfficerAccess`・`resetAutoLockTimer` 必須実行と地区側汚染抑止の分離を明確化。
- `docs/internal_design.md:500`: `resetPasswordInputs(root)` の対象に `#storage-settings-modal`（`#modal-set-pass`, `#modal-set-pass-confirm`, `#modal-set-pass-msg` 等 `.pass-feedback-msg`）を追加。


---

## Gate 1 再レビュー結果（4回目・要是正）

- `docs/internal_design.md:488`: `js/app.js` から `resetActiveAppMode()` を公開し、`tests/helpers/dom-mock.js` の `setupDomEnvironment()` でリセットして `tests/unit/browser-handoff.test.js` のテスト間分離を保つ設計を追記。
- `docs/internal_design.md:492`: `quickSetupEncryptionFromCard(inputId)` 新規設定時の `beginStorageAccess()` 後に `storageAccessBusy = false` 解除および `!access.current()` 時の無通知中断（`handleEnableEncryptionSubmit()` 相当）を明記。
- `docs/internal_design.md:500` / `docs/reviews/review71_security_assessment.md:33`: 汎用 `.pass-feedback-msg` 一括消去をやめてパスワード系5ID（`d-pass-match-msg`, `rep-pass-match-msg`, `neighbor-pass-match-msg`, `modal-set-pass-msg`, `modal-unlock-error`）へ限定（`#rep-new-district-error` 除外）、`#storage-lock-modal` の対象化、および `id` 無し `.btn-toggle-pass` の実数「9箇所」への修正を反映。


---

## Gate 1 最終再レビュー結果（5回目・PASS）

- **レビュワー**: 独立サブエージェント (`Gate 1 QA & Security Lead Reviewer (Final Check)`)
- **判定**: **PASS**
