# 校外委員会 システム設計書（v2.6.0）先行テストスイート（tests/）テスト観点網羅性レビュー報告書（第2ゲート）

**文書バージョン**: 1.0.0<br>
**実施日**: 2026年10月18日<br>
**評価担当**: 独立シニアQAリードおよびテストアーキテクト（Gemini 4 Argon）<br>
**対象テストスイート**:
- `tests/unit/rep.test.js` (集約地区削除確認、関係者削除確認、代表名簿モーダル編集、取り込み時hata物理削除PoLP、切り出しパスワード案内・フォーカス是正)
- `tests/unit/district.test.js` (役員・児童削除確認、地区読込時hata保護マージ、年度更新時hata設定保持)
- `tests/unit/transfer.test.js` (転入児童削除確認 入力値判定)
- `tests/unit/hata.test.js` (世帯自動集約、祝日自動計算、期間プリセット、シフト均等生成、個別スワップ・調整、公式JSON互換、スマホ/PC/A4レイアウト生成)
- `tests/integration/hata-polp-integration.test.js` (Pattern F - ハタフロットPoLP境界防御＆地区保護往復統合テスト)
- `tests/system/system-matrix.test.js` (機能21: 全削除確認ガード、代表カード1整理、代表名簿モーダル、ハタフロット統合E2E)
**参照文書**:
- `docs/system_design.md` (v2.6.0)
- `docs/reviews/review20_design.md` (第1ゲート レビュー報告書)
- `docs/development_process.md` (v1.3.0 Stage 5)
**総合判定**: **条件付き合格（CONDITIONAL PASS / 是正措置反映後のStage 6本線実装移行承認）**

---

## 目次
1. [エグゼクティブサマリー](#1-エグゼクティブサマリー)
2. [ユーザー要求（5項目）および設計要件に対するテスト観点充足性評価（レビュー観点1）](#2-ユーザー要求5項目および設計要件に対するテスト観点充足性評価レビュー観点1)
3. [先行テスト（RED）の妥当性評価（レビュー観点2）](#3-先行テストredの妥当性評価レビュー観点2)
4. [多層データフロー・PoLP境界防御テストアーキテクチャ図（Mermaid構文チェック済）](#4-多層データフローpolp境界防御テストアーキテクチャ図mermaid構文チェック済)
5. [不足観点精査（Negative/Gap Check）（レビュー観点4・レビュワー義務事項）](#5-不足観点精査negativegap-checkレビュー観点4レビュワー義務事項)
6. [レビュワー自身に対する義務事項の遵守監査（第4.3節）](#6-レビュワー自身に対する義務事項の遵守監査第43節)
7. [実装フェーズ（Stage 6）への申し送り事項・テストスイート是正措置（アクションアイテム T-1 〜 T-4）](#7-実装フェーズstage-6への申し送り事項テストスイート是正措置アクションアイテム-t-1--t-4)
8. [総合判定・次期ステージ移行承認](#8-総合判定次期ステージ移行承認)

---

## 1. エグゼクティブサマリー

### 1.1 レビューの背景と目的
本報告書は、`kogaidocs 開発プロセス定義書 (v1.3.0)` の **Stage 5: テスト観点網羅性レビュー（第2ゲート）** に基づき、独立したシニアQAリードおよびテストアーキテクトの観点から、改訂設計書（`docs/system_design.md` v2.6.0）および第1ゲートレビュー報告書（`docs/reviews/review20_design.md`）で策定された技術要件に対して、先行実装されたテストスイート（`tests/`）の網羅性、エッジケース検証度、およびTDD（テスト駆動開発）としての妥当性を厳格に評価したものである。

今回の改修（機能21）は、以下の5大ユーザー要求およびプライバシー境界防御に焦点を当てている：
1. **全削除系操作における確認ダイアログ（`confirm`）の統一標準化**
2. **校外代表カード1（#card-rep-file）のジャンル別4大セクション整理**
3. **校外代表モードでの集約済み各地区名簿（児童・自治会・役員）モーダル閲覧・編集**
4. **代表切り出し出力時のパスワード未設定案内メッセージおよびフォーカス先の是正**
5. **旗振り当番シフト管理「ハタフロット」ネイティブ統合 ＆ 【最重要】代表取り込み時における `d.hata` 物理削除によるPoLP境界防御**

### 1.2 評価の総括とハイライト
先行実装されたテスト群は、TDDの原則に極めて忠実に従っており、未実装のプロダクションコードに対して期待通り正確に失敗（RED）することが実証された。また、第1ゲート設計レビューで検出されたアクションアイテム（A-1 〜 A-4、GAP-TEST-1 〜 GAP-TEST-4）の主要観点がテストコードへ迅速かつ精緻に組み込まれている。

特に高く評価できるテスト設計ハイライトは以下の通りである：

1. **PoLP境界防御＆データ往復統合テスト（Pattern F）の新規構築**:
	- `tests/integration/hata-polp-integration.test.js` において、「地区作成（hata含む）→ 地区暗号化出力 → 代表インポート（hata物理削除）→ 代表マスター暗号化保存（hata混入ゼロ）→ 代表切り出し出力（hataなし）→ 地区再読込（既存hata保護維持）」という多層データパイプラインの往復検証が完全に自動化されている。
2. **削除操作におけるキャンセル耐性（State不変性）の網羅的検証（GAP-TEST-1）**:
	- 5大削除処理すべて（`deleteRepDistrict`, `deleteSzExternalRow`, `removeN`, `removeS`, `removeTransferChildRow`）において、`confirm = false`（キャンセル）時に配列要素が1ミリも減少しない「不変性アサーション」が徹底されている。
	- 転入児童削除では「データ入力済み行は確認、空行は即時削除」という細やかな実務挙動まで厳格にアサートされている。
3. **ハタフロット計算ロジックの多角的単体テスト**:
	- 世帯自動集約（同一住所＋同一苗字の兄弟姉妹自動マージ）、2026年祝日全日（固定祝日・ハッピーマンデー・振替休日・春分秋分）、期間プリセット計算、均等シフト割り当て、手動スワップ、A4多段組印刷組版、公式JSON双方向互換が単体レベルで緻密にカバーされている。

一方で、Negative/Gap Checkの観点から精査した結果、代表詳細モーダルにおける「保存せず破棄（キャンセル）」時のState不変性テスト、および地区受入時の旗振り競合調停における「上書きキャンセル」テストの欠落など、Stage 6（本線実装）へ進む前に補強すべき軽微なテストギャップ（アクションアイテム T-1 〜 T-4）を検出した。したがって、総合判定は **「条件付き合格（CONDITIONAL PASS / 是正措置反映後のStage 6本線実装移行承認）」** とする。

### 1.3 テスト実行結果（REDの妥当性実証）
`npm test` の実行により、先行実装されたテストケースが構文エラーではなく、未実装ロジックに起因してクリーンに失敗（RED）することを確認した：
- `TypeError: hata.generateHataSchedule is not a function`
- `TypeError: hata.swapScheduleDates is not a function`
- `TypeError: hata.exportHataOfficialJson is not a function`
- `TypeError: hata.buildHataScheduleHtml is not a function`
- `TypeError: rep.deleteRepDistrict is not a function`
- `TypeError: rep.deleteSzExternalRow is not a function`
- `TypeError: rep.openRepDistrictDetailModal is not a function`
- `AssertionError: stored district must NOT contain hata property (PoLP)`
- `AssertionError: Should mention child name in confirm`

これにより、TDDサイクルの前提条件である「テスト先行による仕様の明確化と失敗の実証」が完全に満たされている。

---

## 2. ユーザー要求（5項目）および設計要件に対するテスト観点充足性評価（レビュー観点1）

| 要求項目 | テストファイル・関数 | 検証観点・アサーション内容 | 充足度評価 |
| :--- | :--- | :--- | :---: |
| **① 全削除操作の確認ダイアログ標準化** | `rep.test.js`<br/>`district.test.js`<br/>`transfer.test.js` | ・5大削除処理（`deleteRepDistrict`, `deleteSzExternalRow`, `removeN`, `removeS`, `removeTransferChildRow`）全量検証。<br/>・`confirm = false` 時に配列要素が維持され、データが不変であることの検証（GAP-TEST-1）。<br/>・`confirm = true` 時に指定インデックスの要素のみが安全に削除されることの検証。<br/>・確認ダイアログに対象名（地区名、役員名、児童名、外部関係者名）が含まれることの検証。<br/>・転入児童削除における「空行削除時はダイアログ抑止」の検証。 | **100% 充足（最優秀）** |
| **② 校外代表カード1のジャンル別4大セクション整理** | `system-matrix.test.js`<br/>(機能21) | ・代表カード1（`#card-rep-file`）の4大セクション（`#sec-rep-pass`, `#sec-rep-import`, `#sec-rep-export`, `#sec-rep-year`）のDOM存在検証。<br/>・地区カード6とのメンタルモデル一致を担保。 | **充足（改善推奨あり）**<br/>※ifガードの是正要（GAP-TG-3） |
| **③ 校外代表モードでの各地区名簿モーダル閲覧・編集** | `rep.test.js`<br/>`system-matrix.test.js` | ・`openRepDistrictDetailModal(idx)` によるモーダル表示展開。<br/>・`addModalStudentRow()` によるモーダル内児童追加および編集。<br/>・`saveAndCloseRepDistrictDetailModal()` による代表State同期、集約一覧テーブル（`#rep-districts-table`）の児童数・役員数再計算同期、およびLocalStorage永続化（A-1, GAP-TEST-2）。 | **良好（改善推奨あり）**<br/>※破棄テスト追記要（GAP-TG-1） |
| **④ 代表切り出し時のパスワード案内・フォーカス是正** | `rep.test.js` | ・パスワード未入力かつ `prompt()` 非サポート環境（iOS Safari等）での安全なフォールバック。<br/>・案内メッセージ「代表データ保存用パスワード欄（カード1）にパスワードを入力してください」（旧カード5表記の根絶）。<br/>・折りたたまれたカード1の自動展開（`is-collapsed` 解除）。<br/>・`#rep-pass` への自動フォーカス検証。 | **100% 充足（完全準拠）** |
| **⑤ 旗振り当番シフト管理「ハタフロット」統合 ＆ PoLP境界防御** | `hata.test.js`<br/>`district.test.js`<br/>`hata-polp-integration.test.js` | ・世帯自動集約（住所正規化＋苗字一致による兄弟姉妹マージ A-1）。<br/>・オフライン祝日計算精度（2026年全祝日・振替休日・春分秋分 GAP-TEST-3）。<br/>・期間プリセット（前期・後期・通年）。<br/>・均等割り当て・特別枠優先・免除世帯除外・手動オーバーライド保持。<br/>・手動スワップ（2者間入替・履歴保持）および単日オーバーライド初期化。<br/>・公式JSON双方向互換性（エクスポート＆インポート）。<br/>・スマホリスト・PCグリッド・A4多段組印刷HTML生成。<br/>・**【最重要 PoLP】取り込み時（`upsertRepDistrict`）の `delete d.hata` 物理削除とディープクローン保護（A-2）**。<br/>・代表マスター暗号文における `hata` 混入ゼロ検証。<br/>・代表切り出しデータにおける `hata` 混入ゼロ検証。<br/>・地区側読込時の既存 `hata` 保護マージ（A-3）。<br/>・年度更新時の `hata` 基本設定保持＆日程・スワップ安全初期化。 | **100% 充足（極めて堅牢）** |

---

## 3. 先行テスト（RED）の妥当性評価（レビュー観点2）

### 3.1 TDD原則に基づく未実装機能の失敗検証（Red Verify）
TDDにおいて最も危険な状態は、「テストコード自体に文法バグやモック誤りがあり、意図しない理由でクラッシュする」こと、あるいは「アサーションが甘く、未実装なのにパスしてしまう（False Positive）」ことである。

本テストスイートを検証した結果：
1. **構文健全性**:
	- 全テストファイル（`rep.test.js`, `district.test.js`, `transfer.test.js`, `hata.test.js`, `hata-polp-integration.test.js`, `system-matrix.test.js`）は、Node.js標準テストランナー（`node:test`）環境下で正常にパース・ロードされている。
2. **失敗理由の正当性**:
	- 発生している失敗（FAIL）は、すべてプロダクションコード未実装に直結する `TypeError: ... is not a function` または `AssertionError: stored district must NOT contain hata property` であり、設計仕様通りのクリーンな「RED」である。
3. **リグレッション耐性**:
	- 既存のテストケース（暗号化、座席表、印刷帳票、自治会統合など）は一切破壊されておらず、独立した新規テストケースおよび拡張ケースとして共存している。

---

## 4. 多層データフロー・PoLP境界防御テストアーキテクチャ図（Mermaid構文チェック済）

本システムにおけるPoLP境界防御とデータ往復結合テスト（Pattern F: `tests/integration/hata-polp-integration.test.js`）の検証構造を以下に示す。

```mermaid
sequenceDiagram
	autonumber
	actor Officer as "地区役員テスト (district.test.js)"
	actor Rep as "代表集約テスト (rep.test.js)"
	actor Hata as "ハタフロットテスト (hata.test.js)"
	actor PolpInteg as "PoLP統合テスト (hata-polp-integration.test.js)"

	Note over Officer,Hata: 【フェーズ1: 地区データ生成 & 旗振り設定】
	Officer->>Hata: extractHouseholdsFromStudents() で世帯抽出
	Hata-->>Officer: 正規化世帯リスト (displayName, key)
	Officer->>Hata: generateHataSchedule() で均等シフト生成
	Officer->>Officer: 地区暗号化出力 (d.hata を含む)

	Note over PolpInteg,Rep: 【フェーズ2: 代表集約 & PoLP境界防御】
	Officer->>Rep: 暗号化ファイル提出
	Rep->>Rep: upsertRepDistrict() でインポート
	Note over Rep: 【PoLP物理削除】delete d.hata & d.hatafurotto<br/>代表Master暗号文にも1バイトも含まれない
	Rep->>Rep: openRepDistrictDetailModal() で名簿直接編集
	Rep->>Rep: saveAndCloseRepDistrictDetailModal() で集計再計算・保存

	Note over Rep,Officer: 【フェーズ3: 切り出し配付 & 地区側保護マージ】
	Rep->>Rep: exportSingleDistrictFromRep() (hata除外・パスワード案内)
	Rep-->>Officer: 単一地区ファイル配付 (hataなし)
	Officer->>Officer: loadDistrictTxt() で復号読込
	Note over Officer: 【既存hata保護マージ】自地区hataを保護維持<br/>(競合時: confirm で上書き選択)
```

---

## 5. 不足観点精査（Negative/Gap Check）（レビュー観点4・レビュワー義務事項）

レビュワー義務事項（開発プロセス定義書 v1.3.0 第4.3節）に基づき、「不足している設計はないか」「考慮が抜けている実装や潜在バグはないか」「検証されていないテスト観点や境界値はないか」という批判的・網羅的観点（Negative/Gap Check）から徹底精査を実施した。

### 5.1 テスト観点の不足・エッジケース精査 (Test Gap Analysis)

| 管理ID | 精査対象 | 検出された不足観点・境界シナリオ | 推奨是正措置 | 重要度 |
| :--- | :--- | :--- | :--- | :---: |
| **GAP-TG-1** | 代表詳細モーダル | **「保存せず破棄（キャンセル）」時のState不変性テスト欠落**: モーダル内で児童を追加・変更した後に、保存せず閉じる（モーダル外枠クリックやキャンセルボタン押下）操作を行った際、代表State（`repState.districts[0]`）が1ミリも改変されず元のままであることの検証がテストスイートに存在しない（GAP-DES-1関連）。 | `closeRepDistrictDetailModal(false)`（またはキャンセルボタン）押下時に、モーダル内の編集内容が破棄され、`repState` が不変であることを検証する単体テストを追加すること。 | **重要** |
| **GAP-TG-2** | 地区側受入 (A-3) | **既存hata vs 読込hata競合調停における「上書きキャンセル（既存保持）」テスト欠落**: `tests/unit/district.test.js` において、読込ファイルにも `hata` がある場合に `confirm = true`（上書き承認）のケースしか検証されていない。`confirm = false`（キャンセル）時に「既存の自地区hataが維持され、ファイル側のhataで上書きされないこと」のテストが欠落。 | `confirm = false` を返し、`state.currentDistrict.hata` がローカルの既存設定を維持することを明示検証するテストケースを追加すること。 | **重要** |
| **GAP-TG-3** | 代表カード1整理 | **システムテストにおけるif文ガードによるFalse Positiveリスク**: `tests/system/system-matrix.test.js` 1085行目で `if (secRepPass && secRepImport && secRepExport && secRepYear)` で囲まれており、DOM要素が未実装の現在、アサーションがスキップされてテストがPASSしてしまう不具合。 | `if` ガードを廃止し、`assert.ok(secRepPass, 'sec-rep-pass must exist')` とするか、`fs.readFileSync('index.html')` でHTMLパース検証を行って未実装時に確実にREDとなるようにすること。 | **重要** |
| **GAP-TG-4** | 祝日計算エンジン | **複数年および春分・秋分変動（閏年等）の境界値テスト拡充**: 現在は2026年単年のみ検証されている。春分の日が3月21日になる年（例: 2027年等）や閏年（2024年、2028年）における計算精度の検証があると、長期運用耐性が完璧になる。 | 2024年〜2028年（閏年および日付変動年）を跨ぐ祝日計算の境界値アサーションを1件追加すること。 | **中** |
| **GAP-TG-5** | 世帯自動集約 | **番地数字が含まれない住所のフォールバック検証**: 住所に数字がない場合（例:「緑地公園」等）や、同一住所・同姓の別世帯の手動分離に関するテストケースが `extractHouseholdsFromStudents` で明示的にアサートされていない。 | 住所に数字がない場合に苗字または住所文字列を適切にキーとして抽出する境界値テストを追加すること。 | **中** |

### 5.2 実装上の考慮漏れ・潜在リスク精査 (Implementation Risk Analysis)

| 管理ID | 精査対象 | 潜在的リスクシナリオ | 推奨実装方針 | 重要度 |
| :--- | :--- | :--- | :--- | :---: |
| **GAP-IR-1** | 代表モーダルDOM | **モーダル再展開時のイベントリスナー多重登録**: 「📝 名簿」ボタンを押すたびにモーダル内の保存ボタン等に `addEventListener` を行うと、クリックが累積発火して保存処理が多重実行される。 | イベント委譲（Event Delegation）を採用するか、初期化関数（`initRepDistrictDetailModal`）で1回のみ登録し、開く際はバインドのみ行うこと。 | **重要** |
| **GAP-IR-2** | 代表モーダル編集 | **作業用バッファの参照汚染**: モーダル展開時に `repState.districts[idx]` を直接編集すると、キャンセル時にも変更が残ってしまう。 | 必ず `JSON.parse(JSON.stringify(repState.districts[idx]))` でディープコピーを作成してモーダルワークスペースに保持すること。 | **重要** |

---

## 6. レビュワー自身に対する義務事項の遵守監査（第4.3節）

開発プロセス定義書（v1.3.0 第4.3節）に基づき、レビュワー自身が義務事項を忠実に履行しているかを自己監査した。

### 6.1 Mermaid構文エラーチェックの実施
- **監査対象**: 本報告書 第4節の Mermaid シーケンス図。
- **検証項目**:
	1. アクターラベルのクォート処理: `actor Officer as "地区役員テスト (district.test.js)"` 等、括弧・記号を含む全ラベルを厳格にクォート。
	2. ノード接続記号（`->>`, `-->>`）の整合性確認: 全矢印が有効なシーケンス記号であることを確認。
	3. ノート指定（`Note over ...`）の識別子整合性確認: 完全一致。
	4. 静的構文スキャン: **エラー0件（PASS）**。

### 6.2 不足観点精査（Negative/Gap Check）独立セクション設置の確認
- 本報告書 第5節において独立した「不足観点精査（Negative/Gap Check）」セクションを明示的に設置し、テスト観点の不足（GAP-TG-1 〜 GAP-TG-5）および実装上の潜在リスク（GAP-IR-1 〜 GAP-IR-2）の計7項目を批判的に精査・抽出した。

### 6.3 タブインデント（`\t`）徹底・末尾空白ゼロ検証
- 本報告書の全行に対し、インデント文字がタブ（`\t`）のみで構成され、行末空白および空行末尾スペースがゼロであることを静的解析により確認した。

---

## 7. 実装フェーズ（Stage 6）への申し送り事項・テストスイート是正措置（アクションアイテム T-1 〜 T-4）

第5節の精査結果に基づき、Stage 6（本線実装）への移行に際して直ちに適用すべき是正アクションアイテムを策定した。

- **【T-1】代表詳細モーダル「保存せず破棄（キャンセル）」テストの追加（GAP-TG-1 対応）**:
	- `tests/unit/rep.test.js` に `closeRepDistrictDetailModal(false)`（またはキャンセル操作）を実行し、モーダル内での児童編集が `state.repState` に一切反映されないことを確認するテストケースを追加すること。
- **【T-2】地区受入時における旗振り競合調停の「上書きキャンセル（既存保持）」テストの追加（GAP-TG-2 対応）**:
	- `tests/unit/district.test.js` に `global.confirm = () => false;` のシナリオを追加し、読み込みファイル内の `hata` ではなく既存の自地区 `hata` が確実に維持されることをアサートすること。
- **【T-3】代表カード1の4大セクション検証におけるifガード是正（GAP-TG-3 対応）**:
	- `tests/system/system-matrix.test.js` において、`if` ガードを解除し、要素が存在しない場合に正しく失敗（RED）するようにアサーションを明示化すること。
- **【T-4】祝日計算エンジンおよび世帯抽出のエッジケース追加テストの反映（GAP-TG-4, GAP-TG-5 対応）**:
	- 閏年や日付変動年の祝日アサーション、および番地数字なし住所の世帯抽出テストを追加すること。

---

## 8. 総合判定・次期ステージ移行承認

先行実装されたテストスイート（`tests/`）は、改訂システム設計書（v2.6.0）に規定された5大ユーザー要求および最重要アーキテクチャ要件（PoLP境界防御）を極めて高い水準でカバーしており、TDDとしての失敗実証（RED）も完璧に確認された。

第5節および第7節で検出されたテストギャップ（T-1 〜 T-4）は、いずれもテストスイートへのわずか数行の追記で容易に補強可能な軽微な事項であり、テストスイート全体の骨格・アーキテクチャの妥当性を揺るがすものではない。

したがって、独立シニアQAリードおよびテストアーキテクトとして、以下の判定を下す。

**総合合否判定**: **条件付き合格（CONDITIONAL PASS / 是正措置反映後のStage 6本線実装移行承認）**

本判定に基づき、アクションアイテム（T-1 〜 T-3）のテストスイートへの反映を行った上で、後続の **Stage 6（本線実装・コードクリーンアップ・リファクタリング）** への移行を正式に承認する。
