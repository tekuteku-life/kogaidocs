# Gate 1 設計・セキュリティアセスメントレビュー記録（1回目）

**実施日**: 2026年11月19日<br>
**レビュワー**: 独立サブエージェント（Gate 1 QA & Security Lead Reviewer、読取専用）<br>
**対象**: [review78](review78_test_security_assessment.md)、`docs/requirements.md` R-23、`docs/external_design.md` E-12、`docs/internal_design.md` I-12、`docs/specification_traceability.md` 第16節（改訂前）<br>
**判定**: **要是正（手戻り：Stage 2へ差し戻し）**

---

- docs/internal_design.md:519: SEC-30 の保存前検証は本状態を反映した後に保存だけを拒否するため、不合格値がメモリに残り以後の自動保存が拒否され続ける。通知は初回1回だけで、利用者は保存されない編集を続ける。`collectBrowserHandoff`・`performAppUpdate`（`STORAGE_SAVE_REJECTED`）も恒久失敗し「空き容量と暗号化状態を確認」と誤案内する。4.5.3 に反するため、変更前への復帰、拒否継続中の常時表示、`beforeunload` 警告のいずれかを定義すること。
- docs/internal_design.md:519: 検証を排他取得前に置くと、ロック中や `officerPlaintextWriteDenied(storageKey)` が真で書き込まない保存でも通知が出る。ロック中の既定モデルで `storageSaveRejected` が登録されると解除後の本当の不合格で通知されない。通知と集合更新は `saveStorageDataUnlocked` の保護状態・平文拒否判定の通過後に限ること。
- docs/reviews/review78_test_security_assessment.md:32: 横展開漏れ。①`updateS`（js/district.js:284）・`updateN`（js/district.js:260）・`updateSzExternal`（js/rep.js:915）が保存する導出 `name = getFullName(row)` は最大4098文字以上となり `checkRow` の `name` ≤4096 で解除時に拒否される。②`extractHouseholdsFromStudents` の免除キー（js/hata.js:85-89）は最大8193文字だが `validateHataConfig` の `exemptHouseholds` 要素上限は4096文字。導出長に合わせた上限見直しを加えること。
- docs/internal_design.md:520: 範囲外の非空セルが0件で確認を出さない場合にも、空セル（`{refKey:'',customText:''}`）を含む範囲外セルを必ず削除すると明記すること。
- docs/internal_design.md:520: 描画予算の事前検査が `resizeSeatGrid` だけである。`addCurrentDistrictToRep`→`upsertRepDistrict(persist=true)`、`addNewRepDistrict`、`addSzExternalRow`、`addStudentRow`、`addOfficer`、`addNeighborhoodRow`、`onHanListInput` も複製候補を検証してから確定すること。
- docs/reviews/review78_test_security_assessment.md:32: 2.12.0 以前に保存済みの不合格値（範囲外セル、描画予算超過、旗振り展開1MiB超過、長い `name`/免除キー）を解除時に救済する設計がない。`validateStoredData` で複製上を修復する処理を定義すること。平文起動時の `loadAppDataFromStorage` 失敗（js/app.js:1213-1216）は既定状態で起動し次の自動保存で4キーとも上書きされる。
- docs/internal_design.md:521: `handleWebAuthnUnlock`（js/app.js:381）は `err.message` を表示し、検証失敗の文言区別から外れている。E-12-03 の対象を解除処理全般とすること。
- docs/external_design.md:195: E-12-02 は取消時にも通知すると読めるが、I-12 は取消時に通知しない。どちらかに揃えること。
- docs/reviews/review78_test_security_assessment.md:38: SEC-36 の根本原因が誤り。`runAutoHataGeneration` は代入前の `generateHataSchedule` 冒頭（js/hata.js:280-281）で予算超過の例外を投げるため、解除不能値は保存されない。実際の欠陥は未捕捉例外で通知・プレビュー更新がないことである。重大度・成立条件・影響を訂正し、自動生成名簿を `inputDrafts.members` へ入れない中止手順を定義すること。
- docs/internal_design.md:534: QA-07 で注記を再結合すると、`validateHataTextBudget`（js/utils.js:624-625）の `longestNote` 見積もりと不一致になる。同じ `parts` 計算に揃えること。
- docs/internal_design.md:522: 期間プリセットの基準年（暦年か4月始まり年度か）が未定義で、追跡表の1/1・3/31検査に合否基準がない。`getPeriodPresetDates(presetKey, baseYear)` の仕様として明記すること（`isDefaultStartEndDates` も同じ判定）。
- docs/internal_design.md:526: SEC-34 は `storage` イベント契機のため、タブAが排他待ち中にタブBが書くとイベント到着前にタブAが旧全モデルで上書きする競合区間が残る。`saveStorageDataUnlocked` の排他区間内で、キーごとに最後に読んだ・書いた暗号文と現在値を比較して異なれば拒否・ロックする設計と、割込みを再現する実2コンテキスト検査を加えること。
- docs/internal_design.md:526: `handleImmediateLock()` はゲストモードで解除モーダルを開かず、後の `showStorageUnlockModal()` が `#modal-unlock-error` を空にするため E-12-06 の理由表示が実現しない。解除処理中の競合では `handlePasswordUnlock` の catch が理由を「パスワードが正しくないか」で上書きする。理由の保持方法、ゲストモードの表示先（`#guest-storage-notice`）、解除処理中の競合の扱いを定義すること。
- docs/internal_design.md:528: 復元の確認文は `hasOfficerHandoffData(payload)`、置換キーは `hasNonEmptyOfficerModels(values)` で判定が一致しない。モード・役員下書きだけ非空の場合に確認文と実動作が食い違う。同じ判定にすること。
- docs/internal_design.md:530: QA-03 は、旧版の空学年仮行を含む自アプリ出力ファイル・代表マスター、および版1家庭情報統合（`String(child.grade || '1')`）で採用された `'7'`・`'６'` を含むファイルの再取込を不能にする。学年を書き込む全経路の正規化、または仮行の除外と行を特定した通知が必要である。
- docs/internal_design.md:533: QA-06 で正式キーが存在するときに別名の長文を下書きへ移すと、`c.title ?? c.scheduleTitle` 等（js/hata.js:492-499, 671-676, 808）が無視していた別名で有効値が差し替わる。正式キーが `undefined` のときだけ移し、それ以外は別名を削除すること。`metaCreatedDate` と `scheduleCreatedDate` の優先順も定めること。
- docs/specification_traceability.md:376: 保存済み不合格値の解除・復旧、拒否後の継続編集・引き継ぎ作成・アプリ更新、`refKey` 上限境界（4160受理・4161拒否）、生体認証解除の文言、平文起動端末の不正保存値、QA-07 注記長と見積もりの一致、学年 `''`・`'7'` を含む自アプリ出力ファイルの再取込の観点が欠けている。
- docs/specification_traceability.md:380: SEC-33・SEC-35・QA-01 の根拠テストが単体のみである。4.5.6 に従い実Chromium・実WebCrypto・実再解除のheadless検査を加えること。

---

## Gate 1 再レビュー結果（2回目・要是正）

- docs/internal_design.md:545: I-12-05 の修復を `validateStoredData` に入れると、`validateStorageModel` 経由で I-12-01 の `applyStorableChange` と I-12-02 の保存前検証も修復付きで合格し、範囲外セル・4×5で解消する描画予算超過・旗振り予算超過が検出されずに保存され、次回解除時に黙って修復される。I-12-01・I-12-02 は修復なしの厳格な検証を使うと明記すること。
- docs/internal_design.md:534: `name`・`childName` の上限を8193文字に上げると、`normalizeNameFields`・`normalizeOfficerChildNames`（js/utils.js:76-114）が `lastName` 未定義行の空白なし8193文字 `name` を `lastName` へ移し、4096文字上限違反のメモリ値となって以後の保存が拒否され続ける。免除キーも `targetName = lastName || fullName`（js/hata.js:82）で最大12290文字となる。派生上限は構成要素が各4096文字以下の場合に限ること。
- docs/internal_design.md:547: 旧形式の配列 `holidays`・`members`（js/utils.js:728-737）をそのまま `inputDrafts` へ移すと、下書きの文字列要求で拒否され救済が失敗する。`validateHataConfig` と同じ規則で文字列化すること。
- docs/external_design.md:197: E-12-04 の破壊的修復（座席削除・4×5縮小・旗振りの下書き化）の通知方法が未定義で、追跡表の「修復結果を表示」に対応する要素・文言がない。
- docs/internal_design.md:549: `activateStorageKey` の形式移行（js/crypto.js:577-603）は修復済み複製を解除時点で再暗号化して書くため、「保存原本は次回の正常保存まで変更しない」が旧形式端末では成り立たない。移行時の扱いを明記すること。
- docs/internal_design.md:560: I-12-07 の書込停止は、`setupStorageEncryptionUnlocked`（js/crypto.js:657-667）が停止中も4キーを上書きでき、`replaceStoredAppData`・`commitImportedModel` で正しいデータを復元しても停止が解除されず、1キーの不正で全キーが停止する。キー単位とし、暗号化設定・取込・引き継ぎ復元での扱いを定義すること。
- docs/internal_design.md:554: `commitImportedModel`（js/crypto.js:823-828）は `saveStorageDataUnlocked` の例外をすべて `IMPORT_SAVE_FAILED` へ変換するため、取込中の他タブ更新で誤文言となりロック・理由表示も行われない。`STORAGE_FOREIGN_UPDATE` を区別すること。
- docs/internal_design.md:528: 拒否集合の変化は排他区間内で起きるため、そこから `alert` すると Web Lock を握ったままになり他タブの保存・解除・全消去が止まる。通知は排他区間の外で行うこと。
- docs/internal_design.md:588: 家庭情報の学年違反を受ける `loadTransferFileIntoDistrict`・`loadPastedTransferTextIntoDistrict`・`loadTransferFileIntoRep`・`loadPastedTransferTextIntoRep`（js/district.js:912-965、js/rep.js:1028-1075）が「パスワードを確認」と誤案内する。
- docs/reviews/review78_test_security_assessment.md:81: 第6節の判定が改訂前のままで第7節と食い違う。
- docs/reviews/review78_test_security_assessment.md:32: SEC-30・SEC-34・QA-03・QA-06 の是正設計欄が旧設計のままで I-12 と矛盾する。
- docs/specification_traceability.md:378: 空白なし8193文字 `name` の正規化後保存・再解除、配列形式の旗振り修復、書込停止中の暗号化設定・引き継ぎ復元・取込、取込中の `STORAGE_FOREIGN_UPDATE`、厳格検証で修復合格しないこと、家庭情報の学年違反文言の観点が欠けている。

---

## Gate 1 再レビュー結果（3回目・要是正）

- docs/internal_design.md:567: 停止中キーで `saveStorageDataUnlocked` が `false` を返すため、`commitImportedModel`（js/crypto.js:829）は `STORAGE_SESSION_CHANGED` を送出し取込側は無通知で中止する。停止解除に到達しないため、停止を迂回する引数を定義し、解除してよい取込を全体置換の読込（`loadNeighborTxt`・`loadPastedTextToNeighbor` 等）に限ること。
- docs/internal_design.md:566: 停止中キーの `false` は拒否集合に入らないため、`performAppUpdate`（js/app.js:1118）と `collectBrowserHandoff`（js/handoff.js:93-94）が誤案内で恒久失敗する。停止中キーを失敗から除外するか停止を示す文言で中止するかを定義すること（アプリ更新は止めない扱いが望ましい）。
- docs/internal_design.md:537: 緩和条件「`lastName` が文字列」では `lastName: ''` の行が8193文字の `name` を受理し、`getFullName`（js/utils.js:25-31）経由で免除キーが最大12290文字となる。条件を「`lastName` または `firstName` が非空の文字列」（`childName` も同様）とし、追跡表へ検査を加えること。
- docs/internal_design.md:554: `loadAppDataFromStorage` は描画を行わず、描画は呼出元が `access.guard()`・`assertStorageSession` 確認後に行う。`repairs` を戻り値で返し、呼出元が描画とセッション確認の後に通知すること。
- docs/internal_design.md:559: `replaceStoredAppData` の照合不一致時の送出値と排他区間外での `handleForeignStorageUpdate()` 呼出し、`runHandoffTask` の表示（「引き継ぎに失敗しました」を出さないこと）が未定義である。

---

## Gate 1 再レビュー結果（4回目・要是正）

- docs/internal_design.md:537: 緩和条件「`lastName` または `firstName` が非空」では、`lastName` 未定義・`firstName` 非空の行の空白なし8193文字 `name` が通り、`normalizeNameFields`（js/utils.js:78-82）が `lastName` へ8193文字を入れ、以後の保存が拒否され続ける。`typeof lastName === 'string'` を条件に加えること。
- docs/internal_design.md:538: `childName` も同様に `typeof childLastName === 'string'` を加え、追跡表へ `lastName`（`childLastName`）未定義・名のみ非空の8193文字の拒否検査を追加すること。
- docs/internal_design.md:567: 停止中キーの既定モデルを含む引き継ぎを作ると、復元先の有効な自治会・家庭情報が `replaceStoredAppData` で空の既定値に上書きされる。停止中キーを引き継ぎから除くか、停止中である旨の文言で作成を中止するかを定義し、E-12-05 も合わせること。

---

## Gate 1 再レビュー結果（5回目・PASS）

PASS

---

## Gate 1 差分確認（6回目・要是正、PASS 後に実装担当が追加した `setupStorageEncryption` の検証）

- docs/internal_design.md:528: 検証が `generateMasterKey`・`wrapKeyWithPassword`・`registerWebAuthnPrf`（js/crypto.js:629-664）の後になると、不合格中止時に認証器へ孤立した資格情報が残る。また `await` の間のメモリ変更で検証値と書込値がずれる。関数冒頭で4モデルを一度だけ直列化し、その直列化文字列を検証・暗号化の双方に使うこと。追跡表へ、不合格時に `registerWebAuthnPrf` が呼ばれないことと検証後のメモリ変更が書き込まれないことの検査を加えること。

---

## Gate 1 差分確認（7回目・PASS）

PASS

**最終判定**: 合格（5回目で全体 PASS、PASS 後の追加設計 `setupStorageEncryption` の検証は6回目の指摘を反映し7回目で PASS）。

---

## Gate 1 差分確認（8回目・要是正、Gate 2 で判明した仕様未定義4件の明記）

- docs/internal_design.md:529: 拒否集合の消去と警告非表示を `lockStorage()` に置くと、`cancelStorageAccess()`（js/app.js:22-30）が未暗号化端末でも `lockStorage()` を呼ぶため、メモリ上の不合格値が残ったまま警告と離脱確認が解除される。消去は `clearMemoryAndDomForLock()` でメモリを消去する場合と `clearStorageSecurity()` に限ること。

---

## Gate 1 差分確認（9回目・要是正）

- docs/internal_design.md:529: 拒否集合からキーを外す契機が `saveStorageData` の成功だけで、`commitImportedModel`・`replaceStoredAppData` が検証済み値を書いてモデルを置き換えた場合も警告と離脱確認が残る。両者で書き込んだキーを集合から外し、排他区間の外で `reportStorageSaveState(keys, null)` を呼ぶこと。

---

## Gate 1 差分確認（10回目・PASS）

PASS

**最終判定（更新）**: 合格。Gate 2 で判明した仕様未定義の明記（8〜10回目）を含めて PASS。

---

## Gate 1 差分確認（11回目・要是正、Gate 2 2回目で判明した仕様の矛盾・欠落）

- docs/internal_design.md:554: `activateStorageKey` が保持する修復結果の破棄時期が未定義で、解除中断・ロック・読込失敗後に残った結果を別のセッションで誤通知し得る。セッション世代と結び付け、上書き保持し、`lockStorage()`・`clearStorageSecurity()`・世代不一致の引き継ぎで破棄すること。
- docs/internal_design.md:530: 離脱確認が拒否集合だけを対象とし、停止中キーのモードの未保存入力が確認なしで失われる。対象に含めるか否かを I-12-02・E-12-05 に明記すること。

---

## Gate 1 差分確認（12回目・PASS）

PASS

---

## Gate 1 差分確認（13回目・PASS、Gate 3 1回目を受けたシグネチャ・修復条件の明記）

PASS

---

## Gate 1 差分確認（14回目・PASS、Gate 2 5回目を受けた予期しない読込失敗時の停止・引数型の明記）

PASS
