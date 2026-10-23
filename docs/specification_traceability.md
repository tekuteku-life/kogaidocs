# 要件・外部仕様・内部仕様とテストのトレーサビリティ

**作成日**: 2026年10月24日<br>
**対象**: kogaidocs 2.8.4<br>
**対応文書**: [要件定義書](requirements.md)、[外部仕様書](external_design.md)、[内部仕様書](internal_design.md)

## 1. 判定方法と適用範囲

旧 `system_design.md` の全章と、`js/`、HTML/CSS、Service Worker、`tests/unit`・`tests/integration`・`tests/system` を照合した対応台帳である。テスト名の存在やカバレッジ値だけで充足とは判定せず、実際の assertion が確認する値、状態、DOM、拒否時の保全を記載する。同じテストが複数仕様を検査する場合は複数行から参照する。以下の行番号はテスト定義の開始位置であり、テスト名が恒久的な検索キーである。

「既存」は根拠 assertion を確認したことを示し、今回の実行合格を意味しない。実行結果、是正した不足、独立レビューの判定は今回のレビュー記録と突合する。実ブラウザUI試験でも `window.print`、OS共有、実認証器、配信環境の検証には境界がある。

| 要件ID | 対象要求 | 主な外部仕様 | 主な内部仕様 |
| :--- | :--- | :--- | :--- |
| R-01 | 業務目的・ローカル実行 | E-01・E-08・E-09 | I-01・I-06 |
| R-02 | 地区役員の名簿管理 | E-02 | I-03・I-04 |
| R-03 | 校外代表の集約・編集 | E-03 | I-03・I-04 |
| R-04 | 自治会役員の独立管理 | E-04 | I-03・I-04 |
| R-05 | 転入家庭の入力・提出 | E-05 | I-03・I-04 |
| R-06 | 複数経路の統合・同期 | E-06 | I-03・I-04 |
| R-07 | 代表の最小権限と地区設定保護 | E-06 | I-03・I-04 |
| R-08 | 旗振り当番管理 | E-02 | I-03・I-04・I-05 |
| R-09 | 出席管理・座席配置 | E-03 | I-03・I-04・I-05 |
| R-10 | 帳票・印刷・PDF保存補助 | E-07 | I-05 |
| R-11 | 提出データの暗号化 | E-08 | I-02・I-03 |
| R-12 | 端末保存の暗号化・原子性 | E-08 | I-02・I-03 |
| R-13 | 認証・パスワード保護 | E-08 | I-02・I-05 |
| R-14 | ロック・処理世代の管理 | E-08 | I-02・I-04 |
| R-15 | 不信入力の拒否・XSS/漏洩防御 | E-09 | I-02・I-03・I-05 |
| R-16 | 通信制御・PWA更新 | E-01 | I-06 |
| R-17 | ナビゲーション・共有・レスポンシブ | E-01 | I-01・I-05・I-06 |
| R-18 | 品質保証・運用 | 全仕様 | I-07 |

本書の「確認項目」は追跡上の細分であり、外部仕様書・内部仕様書に未定義の新しい仕様IDを追加するものではない。

## 2. 画面・業務操作の追跡

| 要件 / 外部 / 内部 | 確認項目 | 根拠テスト（定義位置・正確なテスト名） | 実際に確認する assertion・境界 |
| :--- | :--- | :--- | :--- |
| R-17 / E-01 / I-01 | 4モード・URL優先・数値別名 | [headless-workflows.test.js:56](../tests/system/headless-workflows.test.js#L56) `UI navigation: mode=${queryMode} restores with URL priority` | 4名称・1〜4・invalidを別ケースとし、各画面の可視性と `kogai_active_mode` を検査する。invalid時は既存neighborを使用する。 |
| R-17 / E-01 / I-01 | 再起動復元・カード開閉・フォーム保持 | [headless-workflows.test.js:67](../tests/system/headless-workflows.test.js#L67) `UI navigation: clicks, card CSS, input retention and actual reload` | 折りたたみ時に入力を不可視とし、ヘッダーで展開する。4モード往復後の地区名、実再読込後の自治会名とモードを確認する。 |
| R-17 / E-01 / I-06 | URL共有と利用者取消 | [headless-workflows.test.js:734](../tests/system/headless-workflows.test.js#L734) `UI app share: native share, cancellation, clipboard and prompt fallbacks` | `mode=transfer` を含む共有URL、AbortError時のコピー副作用なし、API不在時のコピー、コピー拒否時のprompt案内を確認する。OS共有先への実送信は行わない。 |
| R-17 / E-01 / I-05 | モバイル・タブレット・PC表示 | [headless-workflows.test.js:776](../tests/system/headless-workflows.test.js#L776) `UI responsive: ${width}px controls and hata layout remain reachable` | 375/768/1280pxで追加ボタン幅、名簿の横スクロール包含、旗振り表示形式、ページ全体の横はみ出しなしを検査する。 |
| R-02 / E-02 / I-03・I-04 | 班一覧と児童名簿CRUD・並べ替え | [headless-workflows.test.js:84](../tests/system/headless-workflows.test.js#L84) `UI district: top/bottom CRUD, sort order, han options, cancellation and summary` | 班名区切り正規化・重複排除・select更新、上下の行追加、直前の班継承、班長の先頭表示、学区外集計、削除取消/確定を確認する。 |
| R-02 / E-02 / I-03・I-04 | 校外役員複数登録・削除確認 | [headless-workflows.test.js:84](../tests/system/headless-workflows.test.js#L84) 上記テスト | 役員追加・氏名入力の状態反映、削除取消後2人保持・確定後1人を確認する。詳細フィールドは [district.test.js:29](../tests/unit/district.test.js#L29) `district: officers management (render, add, remove)` でも検査する。 |
| R-02 / E-02 / I-05 | 自治会取込パネルの開閉 | [district.test.js:748](../tests/unit/district.test.js#L748) `district: openNeighborImportPanel toggles panel, updates label, and sets aria-expanded (Action Item A-3)` | none/block、ボタン表示、`aria-expanded`、カード展開を確認する。単なる関数呼出回数の検査ではない。 |
| R-02 / E-02 / I-05 | 転入取込パネルの開閉 | [district.test.js:907](../tests/unit/district.test.js#L907) `district: toggleTransferImportPanel toggles panel, updates label, and sets aria-expanded (Action Item A-3)` | 表示切替・aria・展開を確認する。実UI経路は後述の転入統合テストが利用する。 |
| R-02 / E-02 / I-04 | 年度更新の進級・卒業・個人情報消去 | [headless-workflows.test.js:474](../tests/system/headless-workflows.test.js#L474) `UI district year: cancel, grade 1/5/6 boundaries, officer/password purge and hata reset` | 取消時の状態保持、1→2年・5→6年・6年卒業、パスワード欄の消去、旗振りの場所保持と期間消去を確認する。役員・保存パスワードの破棄は `system [パスワード安全記憶]: opt-in persistence, unencrypted storage exclusion, lock wipe, and rollover` と地区の年度更新単体試験に対応する。 |
| R-03 / E-03 / I-04・I-05 | 地区手動追加モーダル | [headless-workflows.test.js:125](../tests/system/headless-workflows.test.js#L125) `UI rep add modal: whitespace, duplicate, error clearing, Enter, Escape and backdrop` | autofocus、空欄・空白・重複拒否、エラー消去、Enterで追加、Escape/背景で閉じる、内容クリックで保持、受理1件だけ保存を確認する。 |
| R-03 / E-03 / I-04 | 集約詳細編集・下書き保存/取消 | [headless-workflows.test.js:160](../tests/system/headless-workflows.test.js#L160) `UI rep detail: all row types, draft discard/save and confirmed deletion` | 役員・児童・自治会行の編集、削除取消、保存後の本状態・集約表示、取消時の本状態不変、保存後の下書き解放を確認する。 |
| R-03 / E-03 / I-04 | 代表の年度更新・組織枠保持 | [headless-workflows.test.js:498](../tests/system/headless-workflows.test.js#L498) `UI neighbor and representative year update: cancel and retain organizational templates only` | 取消、個人情報削除と地区/役職等のテンプレート保持を検査する。 |
| R-04 / E-04 / I-04 | 自治会CRUD・順序・空状態 | [headless-workflows.test.js:189](../tests/system/headless-workflows.test.js#L189) `UI neighbor: add, reorder boundaries, delete cancellation, zero-row state` | 上下の追加、先頭/末尾の移動境界、移動後の順序、削除取消、0行時の描画を確認する。 |
| R-04 / E-04 / I-05 | 自治会の保存カード4区分 | [neighbor.test.js:437](../tests/unit/neighbor.test.js#L437) `neighbor: integrated card (#card-n-file) 4 major sections exist` | `sec-n-pass/save-share/load/year` の存在をDOMモックでassertする。ただしモックは未登録IDを自動生成するため、実HTMLの4区分欠落・包含関係・配置順の検知を保証しない。操作結果は暗号化入出力・年度更新のUI試験へ対応する。 |
| R-04 / E-04 / I-02・I-04 | 読込パスワードの分離 | [neighbor.test.js:366](../tests/unit/neighbor.test.js#L366) `neighbor: loadNeighborTxt and loadPastedTextToNeighbor prioritize #neighbor-import-pass and ignore #neighbor-pass` | ファイル/貼付の復号に読込専用パスワードを渡し、保存用入力が復号パスワードに混入しないことを確認する。 |
| R-04 / E-04 / I-04 | 自治会年度更新 | [neighbor.test.js:297](../tests/unit/neighbor.test.js#L297) `neighbor: runNeighborYearUpdate resets personal info and keeps roles` | 役職は残し氏名/連絡先等を消去する。実UIの取消/確定は上記498行の試験でも確認する。 |
| R-05 / E-05 / I-03 | 転入の提出必須項目 | [transfer.test.js:437](../tests/unit/transfer.test.js#L437) `exportTransferTxt and copyTransferEncryptedText require address and tel (mandatory fields)` | 住所/電話の欠落時はファイルとコピーを拒否し、全必須値がある場合に出力する。氏名・0件は [transfer.test.js:196](../tests/unit/transfer.test.js#L196) `exportTransferTxt and copyTransferEncryptedText validate empty children and invalid password` と対応する。 |
| R-05 / E-05 / I-04 | 兄弟姉妹・暗号出力・リセット | [headless-workflows.test.js:251](../tests/system/headless-workflows.test.js#L251) `UI transfer: sibling inheritance, encryption download/copy, cancel/delete and reset` | 兄弟行の住所等継承、実暗号文の復号内容、コピー、削除取消、リセットを確認する。 |
| R-05 / E-05 / I-03 | 未入力下書き保存 | [security-state.test.js:55](../tests/unit/security-state.test.js#L55) `security: an empty transfer draft is valid local data despite submission requirements` | `{children: [], memo: '下書き'}` を復元できることを検査し、提出要件と保存要件の誤混同を防止する。 |

## 3. 統合・旗振り・座席の追跡

| 要件 / 外部 / 内部 | 確認項目 | 根拠テスト（定義位置・正確なテスト名） | 実際に確認する assertion・境界 |
| :--- | :--- | :--- | :--- |
| R-06 / E-06 / I-04 | 自治会→地区→代表 | [neighbor-merge.test.js:16](../tests/integration/neighbor-merge.test.js#L16) `integration: Pattern A (Standard Order) - Neighbor Export -> District Merge -> District Export -> Rep Import` | 実暗号化出力から地区の自治会置換と既存児童/役員保持、地区出力後の代表受入を確認する。 |
| R-06 / E-06 / I-04 | 自治会先着/後着と複数班 | [neighbor-merge.test.js:126](../tests/integration/neighbor-merge.test.js#L126) `integration: Pattern B (Neighborhood Direct to Rep First) -> District File Follows with Neighborhood Protection`、[同194行](../tests/integration/neighbor-merge.test.js#L194) `integration: Pattern C (District First, Neighborhood Second in Rep Mode)`、[同254行](../tests/integration/neighbor-merge.test.js#L254) `integration: Pattern D (Multi-Han District Sync & Deduplication)` | 入力順の違い、先行自治会の保護、同名地区の複数班への同期と重複排除を確認する。 |
| R-06 / E-06 / I-04 | 自治会ファイル/貼付と地区名不一致 | [headless-workflows.test.js:322](../tests/system/headless-workflows.test.js#L322) `UI neighborhood pipeline: encrypted file/paste and mismatch cancellation preserve other rosters` | UIボタンで実暗号文を取り込み、自治会だけ更新、児童/役員の不変、不一致確認の取消で保全を確認する。 |
| R-06 / E-06 / I-04 | 転入→地区・班選択・重複取消 | [headless-workflows.test.js:282](../tests/system/headless-workflows.test.js#L282) `UI pipeline: transfer file to district, cancelled duplicate, representative split and hata preservation` | 暗号出力から地区へ実ファイル取込、班割当、重複取消、代表切出と地区復元を確認する。 |
| R-06 / E-06 / I-04 | 転入→代表直接 | [headless-workflows.test.js:804](../tests/system/headless-workflows.test.js#L804) `UI rep transfer direct: file picker assigns district and han; cancellation is atomic` | 一般ファイル選択から転入と識別し地区/班へ割当、取消時に既存名簿を保持する。 |
| R-06 / E-06 / I-04 | 学校経由・代表編集・各地区切出 | [transfer-integration.test.js:188](../tests/integration/transfer-integration.test.js#L188) `integration: Pattern E - School Route: Transfer Export -> Rep Direct Import -> Rep Split-Export -> District Load` | 転入出力、代表での受入と編集、切出した地区ファイルの復号・地区読込までを確認する。実際の学校/メール配送は対象外である。 |
| R-06 / E-06 / I-03・I-04 | 複数ファイル集計・代表マスター復元 | [district-rep-sync.test.js:16](../tests/integration/district-rep-sync.test.js#L16) `integration: district -> rep multi-file sync, student aggregation, neighborhood dedup, seat allocation, master export/import` | 3ファイル、同地区5児童・学年別/学区外集計、自治会2地区、役員参照4件の一意性、座席を含むマスター復元を検査する。 |
| R-06 / E-06 / I-04 | 地区貼付復元・代表貼付復元 | [headless-workflows.test.js:790](../tests/system/headless-workflows.test.js#L790) `UI district paste restore: actual button restores file content and local flag settings`、[同1014行](../tests/system/headless-workflows.test.js#L1014) `UI representative master: exported master restores through the paste control` | ファイルだけでなく実貼付コントロールから復元し、地区の既存旗振り設定と代表マスターの内容を確認する。 |
| R-07 / E-06 / I-04 | 旗振り最小権限・往復保護 | [hata-polp-integration.test.js:14](../tests/integration/hata-polp-integration.test.js#L14) `integration: Pattern F - Hatafurotto PoLP boundary defense & round-trip district protection` | 代表状態・復号マスター・切出ファイルに `hata` がなく、旧 `hatafurotto` も除外されること、地区復元で免除/手動調整を保持することを検査する。 |
| R-07 / E-06 / I-04 | 両側に旗振りがある場合の上書き確認 | [district.test.js:1129](../tests/unit/district.test.js#L1129) `district: loadDistrictTxt protects existing hata when incoming has no hata, and confirms override when both have hata (A-3)` | incomingに設定がない場合の保持、両側にある場合の確認/取消を分岐ごとに検査する。 |
| R-08 / E-02 / I-04 | 世帯の正規化・兄弟統合 | [hata.test.js:156](../tests/unit/hata.test.js#L156) `hata: extractHouseholdsFromStudents extracts normalized households and deduplicates siblings (A-1)`、[同204行](../tests/unit/hata.test.js#L204) `hata: extractHouseholdsFromStudents handles edge cases of addresses without numbers, different last names at same address, etc. (T-4 / GAP-TG-5)` | 全角番地の正規化、同一世帯の児童2人、同住所の別姓、番地なし、空住所の世帯キーを検査する。 |
| R-08 / E-02 / I-04 | 祝日・年度期間プリセット | [hata.test.js:174](../tests/unit/hata.test.js#L174) `hata: generateJapaneseHolidays calculates Japanese national holidays accurately (GAP-TEST-3)`、[同225行](../tests/unit/hata.test.js#L225) `hata: getPeriodPresetDates calculates accurate period dates based on reference year` | 2026年の固定/振替/ハッピーマンデー/春秋分と2028年の閏年、前期/後期/通年の日付を検査する。将来の法改正を自動追従する保証ではない。 |
| R-08 / E-02 / I-04 | 当番生成・免除・特別日・手動調整 | [hata.test.js:239](../tests/unit/hata.test.js#L239) `hata: generateHataSchedule allocates duties evenly and respects exclusions & overrides`、[同283行](../tests/unit/hata.test.js#L283) `hata: swapScheduleDates and setDateOverride modifies schedule and updates manualOverrides` | 特別日優先、休日person=`-`、免除世帯の非割当、手動指定と交換結果/overrideを確認する。通常当番の担当数差に対するassertionは不足しているため、均等性まで確認済みとは判定しない。 |
| R-08 / E-02 / I-04・I-05 | 設定・休日復元と実再起動 | [headless-workflows.test.js:526](../tests/system/headless-workflows.test.js#L526) `UI hata: imported holidays survive DOM/state/storage/schedule and actual reload`、[同1033行](../tests/system/headless-workflows.test.js#L1033) `UI hata holiday arrays: normalize, use, save and restore after reload` | 休日のDOM/状態/保存/生成表への反映、配列形式の正規化と実再読込を検査する。 |
| R-08 / E-02 / I-03・I-04 | 不正公式JSONと同一ファイル再選択 | [headless-workflows.test.js:542](../tests/system/headless-workflows.test.js#L542) `UI hata: malformed JSON is reported, state preserved and same file retry enabled` | 空/構文不正/型不正を拒否し旧設定・通知・file input空復帰を検査する。 |
| R-08 / E-02 / I-04・I-05 | 公式JSON双方向と印刷 | [hata.test.js:309](../tests/unit/hata.test.js#L309) `hata: exportHataOfficialJson and importHataOfficialJson guarantee bilateral compatibility`、[headless-workflows.test.js:570](../tests/system/headless-workflows.test.js#L570) `UI hata: generation, exemption, stats, JSON export, print title and cleanup` | エクスポート/取込の設定値、実UIで特別日・休日・統計表示、JSON値、印刷タイトル、作業用印刷DOM消去を確認する。 |
| R-09 / E-03 / I-04 | 出席者の座席候補 | [seat.test.js:12](../tests/unit/seat.test.js#L12) `seat: getAllSzParticipantsForSeat lists facility, officers, neighborhood, and externals` | 印刷対象地区の役員/自治会と出席externalだけを候補とし、未選択地区・欠席者を除外する。施設マーカーも確認する。 |
| R-09 / E-03 / I-03・I-04 | 座席寸法・自由文・左右反転 | [headless-workflows.test.js:604](../tests/system/headless-workflows.test.js#L604) `UI seat editor: min/max resize, facility/custom text, side labels, attendance selection` | 2〜10列・2〜14行、実DOMセル数、施設・自由文、会場ラベル、左右反転、欠席による候補除外を確認する。ドラッグ&ドロップを確認したテストではない。 |
| R-09 / E-03 / I-04 | 外部関係者削除と本人追跡 | [headless-workflows.test.js:628](../tests/system/headless-workflows.test.js#L628) `UI seat deletion: removing another external attendee preserves assigned person` | A削除後もBを割当て、B削除時だけ解除し、取消時の配列保持を確認する。 |
| R-09 / E-03 / I-04 | 地区/校外役員削除の参照繰下げ | [headless-workflows.test.js:644](../tests/system/headless-workflows.test.js#L644) `UI seat deletion: removing preceding district/officer keeps other assignments` | 前方の地区と役員を削除しても後方の役員Bへ座席が残ることを実select表示で確認する。 |
| R-09 / E-03 / I-04 | 自治会削除と出席チェック追跡 | [headless-workflows.test.js:838](../tests/system/headless-workflows.test.js#L838) `UI rep neighbor deletion: selected attendance and seat follow surviving officer` | 自治会行の削除に伴う出席・座席の本人継続を検査する。曖昧な同名地区の参照解除は [ui-regressions.test.js:167](../tests/unit/ui-regressions.test.js#L167) `regression: print selection refreshes seat options and safe ambiguity clears assignments` と対応する。 |

## 4. 帳票の追跡

代表の12種類は `officers_pta/officers_school/reg_tent/envelopes/all_students/all_neighbors/sz_tent/sz_att_1/sz_att_2/sz_att_3/sz_seats/sz_master` である。旗振り表は地区の別系統であり、この12種類に加算しない。

| 要件 / 外部 / 内部 | 確認項目 | 根拠テスト（定義位置・正確なテスト名） | 実際に確認する assertion・境界 |
| :--- | :--- | :--- | :--- |
| R-10 / E-07 / I-05 | PTA用の連絡先限定 | [print.test.js:118](../tests/unit/print.test.js#L118) `print: buildPtaOfficersRosterPageHtml formats PTA roster with contact info for core roles` | 代表氏名・電話と一般役員氏名の存在を検査する。一般役員の電話/メール/住所の非出力はこの既存試験ではassertしておらず、補足対象である。 |
| R-10 / E-07 / I-05 | 学校用の児童・地区集計 | [print.test.js:133](../tests/unit/print.test.js#L133) `print: buildSchoolOfficersRosterPageHtml formats school submission roster with district counts` | 地区・役員/児童氏名、学年/組、住所・電話を検査する。地区集計の根拠は結合試験 `integration: district -> rep multi-file sync, student aggregation, neighborhood dedup, seat allocation, master export/import` と組み合わせる。 |
| R-10 / E-07 / I-05 | 児童名簿の連絡先非表示・班・集計 | [print.test.js:39](../tests/unit/print.test.js#L39) `print: buildStudentPageHtml handles privacy options, multi-han, and district-wide totals` | 電話/メール表示のON/OFF、複数班、地区全体の集計、空名簿を検査する。 |
| R-10 / E-07 / I-05 | 四つ折り名札・封筒12面 | [print.test.js:29](../tests/unit/print.test.js#L29) `print: buildTentCardPageHtml generates origami 4-panel layout with fold lines`、[同166行](../tests/unit/print.test.js#L166) `print: buildEnvelopesPagesHtml formats 3x4 grid with child delivery note` | 名札の氏名/かな/役職/折線マーカー、封筒ページ数1・gridマーカー・宛名・児童への配達文言を確認する。四面数・180度反転・3×4寸法・12面境界はこの既存試験のassertionには含まれない。 |
| R-10 / E-07 / I-05 | 自治会名簿と名札の項目意味 | [print.test.js:99](../tests/unit/print.test.js#L99) `print: buildNeighborPageHtml handles empty and populated neighborhood roster`、[headless-workflows.test.js:691](../tests/system/headless-workflows.test.js#L691) `UI neighbor tent cards: semantic name/kana/role and no-rows guard` | 氏名・かな・役職が正しいDOMへ出力され、自治会名を含むタイトルとなることを確認する。空印刷拒否は [neighbor.test.js:326](../tests/unit/neighbor.test.js#L326) でも検査する。 |
| R-10 / E-07 / I-05 | スクゾ名札・出席簿3種・座席・控え | [print.test.js:191](../tests/unit/print.test.js#L191) `print: buildSzTentCardsPagesHtml generates cards for all attendee groups`、[同199行](../tests/unit/print.test.js#L199) `print: buildSzAttendance sheets and seat chart generators` | 出席者分類、出席簿名、座席と関係者一覧の内容を検査する。 |
| R-10 / E-07 / I-05 | 代表12選択肢の実UI配線 | [headless-workflows.test.js:704](../tests/system/headless-workflows.test.js#L704) `UI representative print: all twelve report choices render, selection controls and empty guard` | 12選択肢それぞれが印刷を1回呼び出し印刷ページを生成すること、全選択と地区対象の切替、空選択拒否を検査する。各帳票の意味内容は上記単体試験と [print-pipeline.test.js:16](../tests/integration/print-pipeline.test.js#L16) `integration: end-to-end print pipeline (single district & representative bulk 12 document types)` で補完する。 |
| R-10 / E-07 / I-05 | 個別PDFと動的タイトル | [headless-workflows.test.js:667](../tests/system/headless-workflows.test.js#L667) `UI print: selected district documents, opt-out contacts, separate titles, empty selection` | 氏名保持、電話/メール非表示、選択2帳票の別々のタイトルと呼出、元タイトル復元、空選択ガイドを確認する。ブラウザ標準ダイアログで実PDFを保存した証拠ではない。 |
| R-08・R-10 / E-07 / I-05 | 旗振り専用組版・旧帳票混入防止 | [hata.test.js:790](../tests/unit/hata.test.js#L790) `hata: genuine Hatafurotto A4 multi-column print layout and empty padding rows (A-1, A-2, A-4, A-5, T-1, T-2)`、[headless-workflows.test.js:878](../tests/system/headless-workflows.test.js#L878) `UI printing CSS: old ordinary reports do not leak into hata print, landscape applies` | 多段/空行パディング/欄構造と、print media下の通常帳票非表示、landscape適用、後始末を確認する。 |

## 5. 暗号化・ロック・取込セキュリティの追跡

| 要件 / 外部 / 内部 | 確認項目 | 根拠テスト（定義位置・正確なテスト名） | 実際に確認する assertion・境界 |
| :--- | :--- | :--- | :--- |
| R-11 / E-08 / I-02 | 新規提出600,000回・形式2 | [security-kdf.test.js:98](../tests/unit/security-kdf.test.js#L98) `SEC-12: new submission payload uses ENC:2: and 600,000 PBKDF2 iterations` | 実暗号文を独立したWebCrypto処理で復号し、形式と反復回数を検証する。 |
| R-11 / E-08 / I-02 | 旧提出互換・未知形式拒否 | [security-kdf.test.js:110](../tests/unit/security-kdf.test.js#L110) `SEC-12: independently generated ${prefix \|\| 'bare Base64'} submission decrypts using ${iterations} iterations`、[同118行](../tests/unit/security-kdf.test.js#L118) `SEC-12: unknown submission version is rejected before PBKDF2`、[同126行](../tests/unit/security-kdf.test.js#L126) `SEC-12: a new-format authentication failure never retries the legacy KDF` | 新旧形式・接頭辞なし互換、未知版のKDF開始前拒否、認証失敗後の旧形式フォールバック禁止を確認する。 |
| R-12 / E-08 / I-02 | 4モード保存暗号・実再起動解除 | [headless-workflows.test.js:366](../tests/system/headless-workflows.test.js#L366) `UI encryption migration: all four modes encrypted, reload locks, wrong/correct unlock restores` | 各保存値が暗号文となり、再起動はロック、誤パスワード拒否、正しい解除で4モード復元する。 |
| R-12 / E-08 / I-02 | 保存暗号文AAD・保存先交換 | [security-crypto.test.js:173](../tests/unit/security-crypto.test.js#L173) `security crypto: new ciphertext authenticates its version and storage slot for every mode`、[同195行](../tests/unit/security-crypto.test.js#L195) `security crypto: ciphertext from ${origin} cannot authenticate as ${target}` | 全モードの形式/AAD、別キーへの暗号文差替え拒否を実暗号化で検査する。 |
| R-12 / E-08 / I-02 | 原子的移行と失敗時ロールバック | [security-kdf.test.js:198](../tests/unit/security-kdf.test.js#L198) `SEC-12: format ${format} metadata commit failure restores every original saved value`、[同214行](../tests/unit/security-kdf.test.js#L214) `SEC-12: combined old-format migration rolls back after the third data write fails` | 旧形式の各データと認証情報を移行し、データ書込途中/メタ情報確定失敗時に全原本を保持する。 |
| R-12 / E-08 / I-02 | 同キー保存順序 | [security-crypto.test.js:359](../tests/unit/security-crypto.test.js#L359) `security crypto: reversed encryption completion cannot replace the latest value with an older save` | 暗号化の完了順が逆転しても最新データが残ることを確認する。 |
| R-12 / E-08 / I-02 | 別コンテキスト排他・全消去 | [security-crypto.test.js:424](../tests/unit/security-crypto.test.js#L424) `security crypto locks: clear requested between setup commit keys waits and leaves every storage key empty`、[同495行](../tests/unit/security-crypto.test.js#L495) `security crypto locks: ordinary encrypted save serializes with ${action} in another tab` | 共通保存領域を共有する別モジュールコンテキストと共有Web Locks fixtureで割込を再現し、複数キー確定/ロールバックと他操作が重ならないことを検査する。実ブラウザ2タブのOSスケジューリングそのものではない。 |
| R-12 / E-08 / I-02 | Web Locks不在時の降格禁止 | [security-crypto.test.js:653](../tests/unit/security-crypto.test.js#L653) `security crypto locks: unavailable Web Locks rejects protected ${action} without altering storage`、[同673行](../tests/unit/security-crypto.test.js#L673) `security crypto locks: unavailable Web Locks still permits unencrypted single-key save, load and complete deletion` | 保護済み操作の保存不変・拒否、未暗号化単一キーの保存/読込/消去だけ許可することを検査する。 |
| R-13 / E-08 / I-02・I-05 | 12文字・一致・可視化・全角正規化 | [utils.test.js:176](../tests/unit/utils.test.js#L176) `utils: validatePassword() enforces security rules`、[同193行](../tests/unit/utils.test.js#L193) `utils: togglePasswordVisibility() toggles password input type and button text`、[同388行](../tests/unit/utils.test.js#L388) `utils: sanitizePasswordInput normalizes full-width characters and preserves caret position` | 最小長と非ASCII拒否、表示切替、全角ASCII変換・除去前後のキャレットを検査する。各モードの不一致確認は個別validator試験へ対応する。 |
| R-13 / E-08 / I-02 | 保存パスワードのオプトインと平文排除 | [system-matrix.test.js:689](../tests/system/system-matrix.test.js#L689) `system [パスワード安全記憶]: opt-in persistence, unencrypted storage exclusion, lock wipe, and rollover` | 暗号化解除時の同意保持、未暗号化時の `savedFilePassword` 除外、ロック/年度更新消去を確認する。 |
| R-13 / E-08 / I-02 | WebAuthn既存保護の再利用 | [app.test.js:897](../tests/unit/app.test.js#L897) `app: WebAuthn unification - quickSetupEncryptionFromCard suppresses credentials.create when storage encryption is already active` | 既存暗号化を利用し `credentials.create` を再実行しないことを確認する。実認証器のパスキー上書き仕様の保証ではない。 |
| R-13 / E-08 / I-02 | 生鍵の成功/例外時ゼロ化 | [security-crypto.test.js:304](../tests/unit/security-crypto.test.js#L304) `security crypto: wrapping failure zeroes the exported setup key`、[同315行](../tests/unit/security-crypto.test.js#L315) `security crypto: rejected biometric registration zeroes the exported active master key`、[同327行](../tests/unit/security-crypto.test.js#L327) `security crypto: ${method} unwrapped raw key is wiped when CryptoKey import fails` | 捕捉したraw bufferが失敗時にも0となることを確認する。JavaScriptコピーやGCまでの完全消去保証ではない。 |
| R-14 / E-08 / I-02・I-04 | ロック時の全状態・全DOM破棄 | [headless-workflows.test.js:398](../tests/system/headless-workflows.test.js#L398) `UI lock purge: all state, draft modal, print, plaintext/paste and revealed password fields` | 4モード、旗振り、代表下書き、印刷DOM、貼付、text型へ表示変更したパスワードを消去する。 |
| R-14 / E-08 / I-02 | 自動ロック期限・復帰時の先行判定 | [security-core-coverage.test.js:216](../tests/unit/security-core-coverage.test.js#L216) `security core: an early timer callback reschedules, while the absolute deadline purges before UI activity`、[同243行](../tests/unit/security-core-coverage.test.js#L243) `security core: visibility return and timer expiry enforce the same deadline; irrelevant storage events do not lock` | タイマー前倒し時の再設定、絶対期限経過、表示復帰、無関係storageイベントの区別を確認する。 |
| R-14 / E-08 / I-02 | 処理中ロック・遅延復号拒否 | [headless-workflows.test.js:990](../tests/system/headless-workflows.test.js#L990) `UI pending decrypt: lock prevents late import from restoring purged personal data` | 取込中にロックし、後から復号が完了しても本状態/DOMを復活させないことを確認する。 |
| R-14 / E-08 / I-02 | 全消去後の自動保存復活禁止 | [headless-security.test.js:300](../tests/system/headless-security.test.js#L300) `Security storage generation: an autosave queued after clear cannot restore erased data as plaintext` | 実ブラウザWeb Locksに保存を待機させ、全消去後は `false`、認証/地区キーnull、旧秘密値が全保存域にないことを検査する。 |
| R-14 / E-08 / I-02 | 他タブ認証変更/全消去 | [security-state.test.js:346](../tests/unit/security-state.test.js#L346) `security: another tab changing authentication metadata purges live secrets immediately`、[同359行](../tests/unit/security-state.test.js#L359) `security: another tab clearing all LocalStorage purges every live model and private DOM`、[同385行](../tests/unit/security-state.test.js#L385) `security: a tab protected before foreign LocalStorage.clear cannot resume plaintext writes` | auth変更/key=nullで全秘密破棄し、旧タブの平文書込を禁止する。 |
| R-15 / E-09 / I-03 | 全モード復元の一括受入 | [security-state.test.js:28](../tests/unit/security-state.test.js#L28) `security: saved models are validated before any of the four modes is committed`、[同43行](../tests/unit/security-state.test.js#L43) `security: malformed saved ${mode} rejects without committing any other mode` | 1モードでも不正なら他の正常モードも部分確定せず、保存値を保持する。 |
| R-15 / E-09 / I-03 | 任意機微項目・描画文字列の型 | [security-state.test.js:255](../tests/unit/security-state.test.js#L255) `security: district ${route} rejects a non-string saved password before changing state or DOM`、[同307行](../tests/unit/security-state.test.js#L307) `security: district ${route} rejects non-string hata.${field} before changing state or DOM` | ファイル/貼付の `savedFilePassword`、旗振りの `scheduleCreatedDate/district` の型不正を状態・DOM変更前に拒否する。保存復元の暗号化/平文は同ファイル277/288/329行でも検査する。 |
| R-15 / E-09 / I-03 | サイズ・深さ・配列・総ノード・予約キー | [security-state.test.js:91](../tests/unit/security-state.test.js#L91) `security: recursive import limits and reserved object properties reject without accepting prototypes`、[同106行](../tests/unit/security-state.test.js#L106) `security: UTF-8 JSON bytes, tree depth, array count and total node limits have exact accepted boundaries` | 予約キー拒否、JSON 4MiB・深さ20・配列10,000・総ノード100,000の境界を検査する。 |
| R-15 / E-09 / I-03 | ファイル8MiBの読込前/後検査 | [security-state.test.js:222](../tests/unit/security-state.test.js#L222) `security: oversized district and flag files are rejected before reading their bodies`、[同232行](../tests/unit/security-state.test.js#L232) `security: read completion enforces actual UTF-8 file size despite misleading File.size` | bodyを読む前の拒否と、不正なsize申告を含む内容側上限を確認する。 |
| R-15 / E-09 / I-03 | 旗振り範囲展開の計算量境界 | [security-date-boundary.test.js:90](../tests/unit/security-date-boundary.test.js#L90) `security date boundary: ${name} accepts exactly 3660 expansions at every model validator`、[同101行](../tests/unit/security-date-boundary.test.js#L101) `security date boundary: ${name} rejects 3661 expansions at every model validator` | 期間・休日・特別枠の3,660/3,661境界を共通validatorで検査し、ファイル/貼付/平文/暗号化/旧形式復元の保全試験へ展開する。 |
| R-15 / E-09 / I-05 | 地区の永続化型XSS | [headless-security.test.js:124](../tests/system/headless-security.test.js#L124) `Security district: encrypted hostile names survive import, save, reload and printing as text` | 実WebCryptoファイル→役員/児童DOM→保存→実再起動→印刷を通す。元文字列保持、実行フラグなし、攻撃img/form/styleなし、ロックDOMの重複なしを確認する。 |
| R-15 / E-09 / I-05 | 代表マスター・席注記のXSS | [headless-security.test.js:140](../tests/system/headless-security.test.js#L140) `Security representative: encrypted names and seat notes remain text after master restore and reload` | 外部組織名・役員名・席の自由文を実マスター取込/再起動/印刷へ通し、文字列保持と攻撃DOMなしを確認する。 |
| R-15 / E-09 / I-05 | 自治会ファイル・名札のXSS | [headless-security.test.js:165](../tests/system/headless-security.test.js#L165) `Security neighbor: encrypted hostile names survive file import, reload, roster and tent printing` | 自治会取込/保存/再起動/名簿/名札の双方で悪意氏名をテキストとして保持し、実行しないことを確認する。 |
| R-15 / E-09 / I-02・I-05 | 転入の暗号提出・XSS | [headless-security.test.js:186](../tests/system/headless-security.test.js#L186) `Security transfer: native form to real encrypted submission, district import, reload and print` | 暗号出力に平文児童名なし、復号した元文字列一致、地区取込・再起動・印刷で非実行を確認する。 |
| R-15 / E-09 / I-03・I-04 | prototype汚染と通常文字列の区別 | [headless-security.test.js:213](../tests/system/headless-security.test.js#L213) `Security prototype: official JSON assignee ${name} never mutates shared objects` | `__proto__/constructor/toString` を担当者文字列として公式JSON取込し、prototype/Object/組込関数のdescriptor不変、表示/集計の正常性を確認する。 |
| R-15 / E-09 / I-05 | CSP・固定アクション表 | [headless-security.test.js:226](../tests/system/headless-security.test.js#L226) `Security CSP: inline script, inline event, eval, base and form submissions are blocked`、[events-security.test.js:249](../tests/unit/events-security.test.js#L249) `events: unknown names and invalid parameters cannot resolve global functions or object properties` | script/event/eval/base/formそれぞれにCSP違反通知を待ち、実行フラグなしとbaseURI不変を検査する。未知アクション/不正引数から任意グローバルやプロパティを呼ばないことも検査する。 |
| R-15 / E-09 / I-02 | 改竄暗号文と部分解除防止 | [headless-security.test.js:252](../tests/system/headless-security.test.js#L252) `Security authentication: tampered ${mode} tag cannot unlock or expose partial restored state` | 4モードの実認証タグを破損、実再起動後の解除でエラー、ロック継続、全モデル/入力/印刷に秘密なし、破損原本不変を確認する。 |

## 6. 通信・PWA・品質の追跡

| 要件 / 外部 / 内部 | 確認項目 | 根拠テスト（定義位置・正確なテスト名） | 実際に確認する assertion・境界 |
| :--- | :--- | :--- | :--- |
| R-16 / E-01 / I-06 | 版確認・失敗・取消UI | [headless-workflows.test.js:756](../tests/system/headless-workflows.test.js#L756) `UI version settings: pending button, failure recovery, current/latest and cancellation` | 二重クリック防止、503失敗表示とボタン復帰、最新版/取消のフィードバックを検査する。fetch応答は置換している。 |
| R-16 / E-01 / I-06 | 更新ループ抑止・手動再試行 | [app.test.js:663](../tests/unit/app.test.js#L663) `app: checkAppVersion infinite update loop prevention safety guard with sessionStorage` | 直前更新対象の自動再通知抑止、手動の再確認許可、成功後の履歴消去を検査する。 |
| R-16 / E-01 / I-02・I-06 | 全保存を待って更新・保存失敗中止 | [security-state.test.js:140](../tests/unit/security-state.test.js#L140) `security: updating waits for every save before navigation`、[同182行](../tests/unit/security-state.test.js#L182) `security: rejected persistence prevents update and never reports a successful reload` | 4モード保存が完了するまで移動しないこと、失敗通知と更新中止を検査する。 |
| R-16 / E-01 / I-06 | 他アプリのcache/SW保護 | [security-state.test.js:199](../tests/unit/security-state.test.js#L199) `security: update clears only this scope cache and service worker registration` | 自scopeのcache接頭辞/scriptURL/scopeだけ削除し、同一originの別アプリを残すことを検査する。 |
| R-16 / E-01 / I-06 | SW install・公開資産の匿名取得 | [sw-security.test.js:127](../tests/system/sw-security.test.js#L127) `security SW: install precaches only public assets in its scope and activates successfully` | 許可静的資産の取得/保存、version/query除外、`credentials=omit/cache=no-store`、scope付きcache名を確認する。Request/Responseは標準実装、CacheStorageとnetworkはfixtureである。 |
| R-16 / E-01 / I-06 | SW cold/cached応答とruntime匿名取得 | [sw-security.test.js:154](../tests/system/sw-security.test.js#L154) `security SW: allowlisted static assets still support a cold fetch and a cached fetch`、[同166行](../tests/system/sw-security.test.js#L166) `security SW: runtime ${cached ? 'background refresh' : 'cold fetch'} is anonymous and bypasses the HTTP cache` | キャッシュした応答自体が返ることと、初回/バックグラウンド更新で元要求に依存せずomit/no-storeとなることを検査する。 |
| R-16 / E-01 / I-06 | SW不許可URL/要求の非保存 | [sw-security.test.js:232](../tests/system/sw-security.test.js#L232) `security SW: ${name} is never persisted` | version/query/未知URL/外部/別scope/Authorization/Cookie/credentials include/POSTの各入力で保存件数0を要求する。 |
| R-16 / E-01 / I-06 | SW非公開応答とfiltered Cookieの限界 | [sw-security.test.js:146](../tests/system/sw-security.test.js#L146) `security SW: install rejects ${name} responses before persisting any asset`、[同197行](../tests/system/sw-security.test.js#L197) `security SW: ${policy} remains non-cacheable when a browser hides Set-Cookie`、[同246行](../tests/system/sw-security.test.js#L246) `security SW: a ${policy} response cannot be persisted even at an asset URL` | private/no-storeと露出Cookie応答の保存0、非公開Cookieが見えなくても可視Cache-Controlで拒否することを確認する。匿名公開応答の安全性は配信契約も前提である。 |
| R-16 / E-01 / I-06 | SW別アプリcacheと旧cache隔離 | [sw-security.test.js:211](../tests/system/sw-security.test.js#L211) `security SW: an asset response in an unrelated cache cannot substitute for the current app cache`、[同254行](../tests/system/sw-security.test.js#L254) `security SW: a legacy cached private response is not served for an unknown URL`、[同262行](../tests/system/sw-security.test.js#L262) `security SW: activate deletes only stale caches belonging to the exact registration scope` | 他アプリ/旧private応答を返さず、自scopeの旧cacheだけ削除して別scopeと別アプリを保持することを確認する。 |
| R-18 / 全仕様 / I-07 | 構文・DOM ID・多重listener | [static-analysis.test.js:9](../tests/system/static-analysis.test.js#L9) `Mechanical Static Analysis: Syntax, DOM element ID consistency, and listener safety` | 全JSを `node --check`、定数getElementById参照とHTML/動的ID台帳、単純形の重複listener登録を検査する。完全な静的型証明ではない。 |
| R-18 / 全仕様 / I-07 | 単一グローバル環境ロード | [browser-runtime-evaluation.test.js:7](../tests/system/browser-runtime-evaluation.test.js#L7) `browser runtime evaluation: all scripts in index.html load cleanly without SyntaxError or ReferenceError in shared global scope` | HTML記載順の全scriptを同一VMグローバルで連続評価して例外なしを確認する。DOM/APIはモックである。実UI試験も起動・非同期エラー配列の空を要求する。 |
| R-18 / 全仕様 / I-07 | バージョン定義整合 | [version-consistency.test.js:10](../tests/unit/version-consistency.test.js#L10) `Version Consistency Suite: SSOT verification across all configuration files` | package/version/SW/appのsemver形式と4者同値を機械検査する。 |

## 7. 不足の判定と補足対象

既存のテストは、4モードの通常/境界/異常操作、暗号取込、永続化型XSS、原子的な保存復元、旗振りPoLP、座席の本人追跡まで確認している。既存assertionを「未実装」として再計上しない。

初回監査では以下を不足・検証境界として抽出した。追加後の解消状況は第8節と今回のレビュー記録へ記載する。

1. **情報漏洩の観測**: 既存の悪意データ実UI試験は攻撃DOM/実行フラグ/CSP違反を確認する一方、ネットワーク要求や外部共有へ秘密値が出ないことを直接観測するassertionが不足している。取込・再起動・通常画面・印刷後の通信/共有境界で秘密の混入を検査する必要がある。
2. **公式旗振りJSONの悪意表示値**: prototype予約名は実UIで確認しているが、公式JSON中のタイトル・場所・担当者・注記等をXSS文字列にして、保存・実再起動・プレビュー・印刷まで通す試験は地区/代表/自治会/転入の攻撃試験とは別に補完する余地がある。
3. **PTA帳票の非開示項目**: 既存PTA帳票試験は代表連絡先の存在と一般役員氏名を確認するが、一般役員の住所・電話・メール、児童氏名/組が出力されないことの直接assertionが不足している。実データの混入を検知する負の検査を追加する。
4. **旗振り均等性**: 既存生成テストの名称に均等性が含まれるが、担当者ごとの通常割当件数差を確認していない。免除/特別/手動調整を除いた基本ラウンドロビンで件数差が1以内となることを確認する。
5. **名札・封筒の数量/組版**: 名札の四面数と180度反転、封筒の3×4と12面境界の直接assertionが不足している。生成HTMLの文字列マーカーだけを満たしても、四面/反転/ページ分割が欠けた変更を検知できるとは限らない。
6. **検証範囲の明示**: file起動のUI合格だけでは、公開HTTPSのヘッダー/TLS、Service Worker実インストール・実オフライン更新、実OS認証器、OS印刷保存・共有先の実配送を合格としない。これらは配信・実機受入の未検証事項として残す。
7. **品質ゲートの実測**: 過去の621件/97件等の記録を今回の合格件数として流用しない。今回変更後の `npm test` / `npm run test:ui` と各モジュールLine 100%・Branch 95%以上を確認し、未達の場合は完了/PASSとしない。

追加テストの実名・結果および是正後の残余リスクは、今回のテスト/最終レビュー記録から本書へ追記する。文書上の「法的準拠」や「完全同一」等の断言は、自動テストで証明した事項と区別する。

## 8. 今回補足した仕様適合テスト

以下は第7節3〜5の不足を補う追加テストである。本番コードを変更する前に追加し、対象限定の16件を実行して全件合格した。これは対象限定の結果であり、全回帰・カバレッジ・独立Gate 2/3の完了判定ではない。

| 要件 / 外部 / 内部 | 追加テストの正確な名称 | 追加したassertion |
| :--- | :--- | :--- |
| R-10・R-15 / E-07 / I-05 | [specification-contracts.test.js:34](../tests/unit/specification-contracts.test.js#L34) `specification PTA privacy: general officer contacts, addresses and child identities are excluded while core contacts remain` | 一般役員の氏名/児童学年と三役の電話/メールは掲載し、一般役員の電話/メール/住所、全役員の児童氏名/組、三役の住所の一意なcanary値は非掲載とする。一般役員が連絡先別掲へ混入しないこともDOMで検査する。 |
| R-08 / E-02 / I-04 | [specification-contracts.test.js:75](../tests/unit/specification-contracts.test.js#L75) `specification flag fairness: ${name} allocates each regular date exactly once with a count difference at most one` | 0世帯・1世帯・人数の倍数/余り・キー形式/表示名形式の免除・全世帯免除の6件で、独立したUTC暦の全許可日に重複欠落なく割り当て、対象世帯の循環順と件数差1以下を検査する。対象世帯が0なら架空の担当者を生成しない。 |
| R-08 / E-02 / I-04 | [specification-contracts.test.js:87](../tests/unit/specification-contracts.test.js#L87) `specification flag fairness: holidays and fixed specials consume no regular turn; a manual override changes only its date` | 休日/固定担当特別日を通常輪番から除外し、残りの日の公平性を確認する。手動調整では指定日のみ担当を変更し、その後の順番を変えない。空担当の特別枠は輪番を消費するため、この公平性条件へ混同しない。 |
| R-10 / E-07 / I-05 | [specification-contracts.test.js:106](../tests/unit/specification-contracts.test.js#L106) `specification tent card: four panels carry two matching names around one central fold with one upside-down face` | 4面、氏名表示2面の氏名/かな/役職一致、片面だけ反転、中央折線が両表示面の間にあることとCSSの180度宣言を検査する。 |
| R-10 / E-07 / I-05 | [specification-contracts.test.js:129](../tests/unit/specification-contracts.test.js#L129) `specification envelopes: ${count} recipients occupy exactly twelve cells per page without loss or duplication` | 0/1/12/13/24/25人の6件でceil(n/12)ページ・全ページ12面・末尾の空欄数・児童/宛名/学年/組・順序・重複欠落なし、児童なし役員の除外とCSSの3列4行を検査する。 |
| R-10 / E-07 / I-05 | [headless-specification-contracts.test.js:5](../tests/system/headless-specification-contracts.test.js#L5) `UI specification print geometry: tent display face rotates 180 degrees and thirteen envelope recipients form two 3-by-4 grids` | Chromiumのprint mediaでDOMMatrixが180度、もう片面が無回転、封筒13人が2ページ、computed gridが3列4行、全セルの実座標が該当行/列へ整列し、2ページ目に13人目が出ることを確認する。OS印刷/PDF実保存の検証ではない。 |

対象限定実行コマンドは `node --test --test-concurrency=1 tests/unit/specification-contracts.test.js tests/system/headless-specification-contracts.test.js` である。制限環境ではNode子プロセス起動が失敗したため、同じコマンドを子プロセス/Chromiumが起動可能な環境で再実行して16/16合格を確認した。

## 9. セキュリティ追加是正・漏洩観測の追跡

SEC-18/19の脅威と成立条件は [取込セキュリティ評価](reviews/review55_import_security_assessment.md)、設計判定は [Gate 1](reviews/review56_specifications_design.md) と [日付手戻りGate 1](reviews/review57_date_rework_design.md) に対応する。SEC-19の自動祝日補完範囲は後者の2000〜2099年の契約を用いる。

| 要件 / 外部 / 内部 / 指摘 | 具体テスト（定義位置・正確な名称） | 実際に確認するassertionと制約 |
| :--- | :--- | :--- |
| R-03・R-04・R-15 / E-06-04 / I-04 / SEC-18 | [security-import-lifecycle.test.js:38](../tests/unit/security-import-lifecycle.test.js#L38) `security lifecycle: ${mode} rollover removes imported aliases and surplus private fields from storage, print and encrypted handoff` | 自治会/代表の2件で旧name/kanaと正式氏名・連絡先・任意contact/extraを実暗号化取込する。取消時は全モデルと保存原本を維持し、確定後は役職/順序（代表は区分/所属/attend:true）だけを残す。保存復元・帳票・通常出力の復号内に旧値がないことを検査する。 |
| R-03・R-04・R-15 / E-06-04 / I-04 / SEC-18 | [headless-lifecycle-security.test.js:38](../tests/system/headless-lifecycle-security.test.js#L38) `Security lifecycle UI: ${mode} imported legacy secrets disappear after rollover, real restart, printing and handoff` | 自治会/代表の2件で実ファイル選択、取消/確定のUI、保存完了、印刷呼出と旧秘密なし、暗号化引継出力の復号、実再起動後の状態/保存/再出力を検査する。OS印刷と外部配送は対象外である。 |
| R-08・R-15 / E-09-01・E-09-02 / I-03 / SEC-19 | [security-import-lifecycle.test.js:95](../tests/unit/security-import-lifecycle.test.js#L95) `security lifecycle: isolated ${endpoint}=${value} rejects at every model and official JSON boundary` | 単独start/endにbad、2026-02-30、桁不足、10000年を入力する8件で、旗振りvalidator・地区/代表取込validator・保存validator・公式JSON変換が `INVALID_IMPORT_DATA` を返すことを検査する。 |
| R-08・R-15 / E-09-02・E-09-03 / I-02・I-03 / SEC-19 | [security-import-lifecycle.test.js:107](../tests/unit/security-import-lifecycle.test.js#L107) `security lifecycle: ${route} refuses isolated ${endpoint}=${value} before model, DOM or storage replacement` | 上記端点8種類×file/paste/plaintext/encryptedの32件で、全4モデル、既存DOM、保存原本の不変を要求する。file入力クリア、失敗した貼付の保持、通知、実暗号化保存の解除失敗と鍵不活性も検査する。 |
| R-08・R-15 / E-09-02・E-09-03 / I-03 / SEC-19 | [headless-lifecycle-security.test.js:78](../tests/system/headless-lifecycle-security.test.js#L78) `Security lifecycle UI: ${route} rejects invalid isolated dates and preserves models, DOM and saved originals` | file/paste/officialの3件でstart/endそれぞれの非実在日を実DOM経路から入力し、失敗通知、全モデル/地区/旗振りDOM/保存値の不変、拒否した貼付の保持を確認する。 |
| R-08・R-15 / E-09-02 / I-03 / SEC-19 | [security-import-lifecycle.test.js:140](../tests/unit/security-import-lifecycle.test.js#L140) `security lifecycle: valid incomplete date draft ${JSON.stringify(config)} stays accepted and renderable` | 未指定・両端空・閏日のstartのみ/endのみの4件を受け入れ、描画例外なし、入力端点が保持されることを検査する。 |
| R-08・R-15 / E-09-02 / I-03 / SEC-19 | [security-import-lifecycle.test.js:151](../tests/unit/security-import-lifecycle.test.js#L151) `security lifecycle: year ${year} has a renderable bounded automatic holiday draft` | 0/1/99/100/1999/2000/2099/2100/9998/9999年の10件を実暗号化地区取込へ通す。成功通知、日付DOM、休日文字列、2000〜2099年内の実生成と2100年非混入、範囲外の空補完を検査する。日付の受入範囲と暦の自動生成範囲を区別する。 |
| R-08・R-15 / E-09-02 / I-03 / SEC-19 | [security-import-lifecycle.test.js:170](../tests/unit/security-import-lifecycle.test.js#L170) `security lifecycle: explicit holidays ${JSON.stringify(holidays)} survive an out-of-range calendar year`、[headless-lifecycle-security.test.js:109](../tests/system/headless-lifecycle-security.test.js#L109) `Security lifecycle UI: valid upper-year import survives real restart without invalid automatic holidays` | 単体2件で9999年の明示休日/明示空文字が保持されること、UI1件で9999年の実暗号化取込・実再起動後にも有効日付と空補完を維持することを検査する。 |
| R-01・R-15・R-17 / E-09-04・E-01-02・E-01-05 / I-05・I-06 | [headless-import-leakage.test.js:159](../tests/system/headless-import-leakage.test.js#L159) `Security leakage file: encrypted DOM file import, save, reload, print and app URL sharing (file origin)`、[同166行](../tests/system/headless-import-leakage.test.js#L166) `Security leakage paste: encrypted DOM paste import, save, reload, print and app URL sharing (file origin)` | file/貼付の2件で名簿・電話・パスワードcanaryを含む外部画像/相対URL画像/CSS/イベント風文字列を実暗号化取込し、保存/実再起動/通常帳票へ通す。元文字列保持、攻撃DOM/実行フラグ/CSP違反なし、共有とコピーへ渡るアプリURLに個人値・パスワード・暗号本文なしを検査する。 |
| R-08・R-15 / E-02-07・E-09-04 / I-03・I-04・I-05 | [headless-import-leakage.test.js:173](../tests/system/headless-import-leakage.test.js#L173) `Security leakage official JSON: hostile metadata, assignee and note survive file import, save, reload and Hata printing (file origin)` | 公式JSONのtitle/location/header/footer/contact/担当者/注記へ上記攻撃文字列を入れ、実ファイル取込、保存、実再起動、生成表、実一時印刷DOMまで全文を保持する。外部membersは児童名簿を置換せず、印刷DOMは後片付けされることを検査する。 |
| R-01・R-15 / E-09-04 / I-06 | [headless-import-leakage.test.js:133](../tests/system/headless-import-leakage.test.js#L133) 共通 `leakageTest` と [headless-runner.js:182](../tests/system/helpers/headless-runner.js#L182) CDP観測 | `observeNetwork` 時だけ対象ページsessionの `Network.requestWillBeSent` からURL/method/headers/postData/typeを収集する。3試験それぞれで初回/再読込の正常画像要求を捕捉する正の対照を要求し、収集要求のURL/ヘッダー/本文へ平文/URL符号化canaryなし、攻撃宛先なしを検査する。最大本文収集は1MiBであり、全ブラウザ・全形式・サーバー受信の証明ではない。 |

SEC-18/19先行Redの記録は64件中7件合格・57件失敗であり、本番修正前に既存不具合を検知した結果である。その後、是正後の対象限定実行64/64合格が統合担当から報告された。第8節の不足補足16件とは異なる集合であり、最終の全回帰件数やカバレッジ合格を意味しない。漏洩3件を含む最終結果は、全回帰・最終レビュー記録で確定する。

## 10. 外部仕様の下位項目索引と残る細部

第2〜9節は機能/攻撃経路単位の台帳であり、以下は外部仕様に定義された46個の下位IDすべてを、その台帳と根拠テストへ引き直す索引である。E-07には下位IDがなく、第4節の各帳票行と第8節で追跡する。下位IDへテストを対応させたことは、同じ行に記載する全副条件の完全検査を意味しない。未確認の細部は明示する。

| 外部仕様ID | 対応する確認項目・根拠位置 | 補足・不足 |
| :--- | :--- | :--- |
| E-01-01 | 第2節「4モード・URL優先・数値別名」・[headless-workflows:56](../tests/system/headless-workflows.test.js#L56) | URL/保存モードの優先と不正別名を検査する。 |
| E-01-02 | 第2節「URL共有と利用者取消」・[headless-workflows:734](../tests/system/headless-workflows.test.js#L734)、第9節漏洩観測 | アプリURL共有と名簿の意図した提出共有を区別する。 |
| E-01-03 | 第2節「再起動復元・カード開閉・フォーム保持」・[headless-chrome:6](../tests/system/headless-chrome.test.js#L6) | バッジ表示とクリック時の4選択肢展開を確認する。 |
| E-01-04 | 第2節「再起動復元・カード開閉・フォーム保持」・[headless-workflows:67](../tests/system/headless-workflows.test.js#L67) | 実再起動で選択モードを復元する。 |
| E-01-05 | 第2節「URL共有と利用者取消」・[headless-workflows:734](../tests/system/headless-workflows.test.js#L734)、第9節漏洩観測 | OS共有ダイアログとPWAインストール後の実配送は未検証である。 |
| E-01-06 | 第6節の版確認/ループ抑止/全保存/自scope/SW各行 | 公開HTTPSでの更新/SWオフライン実動作は未検証である。 |
| E-01-07 | 第2節の地区CRUD・代表詳細・自治会CRUD・転入操作、第3節座席削除各行 | [transfer:405](../tests/unit/transfer.test.js#L405) `removeTransferChildRow prompts confirmation when row has data and deletes only on OK (GAP-TEST-1)` は未入力下書きの例外も検査する。 |
| E-02-01 | 第2節「班一覧と児童名簿CRUD・並べ替え」・[headless-workflows:84](../tests/system/headless-workflows.test.js#L84) | 班正規化とselect候補を検査する。 |
| E-02-02 | 第2節「校外役員複数登録・削除確認」・[district:29](../tests/unit/district.test.js#L29) | [system-matrix:135](../tests/system/system-matrix.test.js#L135) `system [編集]: field editing, real-time title reflection, student multi-tier sort, and Hata template generation` がヘッダー反映を検査する。 |
| E-02-03 | 第2節「自治会取込パネルの開閉」、第3節「自治会ファイル/貼付と地区名不一致」 | 初期表示・上下追加・不一致取消・他名簿保持を複数ケースで追う。 |
| E-02-04 | 第2節「転入取込パネルの開閉」、第3節「転入→地区・班選択・重複取消」 | 入力ダイアログと班指定を通す。 |
| E-02-05 | 第2節「班一覧と児童名簿CRUD・並べ替え」・[utils:210](../tests/unit/utils.test.js#L210) `utils: compareStudents() correctly implements multi-tier sorting` | 班/役職/学年/住所/クラス/かなの比較結果を単体で補完する。 |
| E-02-06 | 第4節「個別PDFと動的タイトル」・[headless-workflows:667](../tests/system/headless-workflows.test.js#L667) | OSのPDF実保存は未検証である。 |
| E-02-07 | 第3節旗振りの全行、第2節375/768/1280px、第4節旗振り組版、第8節公平性、第9節公式JSON、第11節レスポンシブ補足 | 当番表の表示形式に加え、スマホコピー縦並び・PC設定欄2列×2段をcomputed styleと実座標で補完した。 |
| E-02-08 | 第2節年度更新、第3節貼付/設定保護、第5節記憶パスワード・[district:499](../tests/unit/district.test.js#L499) `district: shareDistrictData handles Web Share, LINE, Email, and Clipboard with URL length fallback`、第11節保存カード構造 | LINE/mail/Web Share/コピーと長文退避を検査する。実DOMの4区分/主要control/最下部配置も補完した。 |
| E-03-01 | 第2節代表操作、第3節代表集約/マスター、第5節認証、第9節年度更新、第11節保存カード構造 | [system-matrix:1056](../tests/system/system-matrix.test.js#L1056) の存在assertだけでは構造欠落検知が弱いため、実DOMの包含/順番/最下部配置を追加した。 |
| E-03-02 | 第3節「複数ファイル集計・代表マスター復元」「旗振り最小権限・往復保護」 | 復号されたマスターと切出し内容でもPoLPを検査する。 |
| E-03-03 | 第2節「地区手動追加モーダル」・[headless-workflows:125](../tests/system/headless-workflows.test.js#L125) | direct引数互換は [rep:1777](../tests/unit/rep.test.js#L1777) `rep: addNewRepDistrict with argument directly adds district, without argument opens modal` と対応する。 |
| E-03-04 | 第2節「集約詳細編集・下書き保存/取消」、第3節本人追跡 | 保存実行と通常クローズ/取消を区別する。 |
| E-03-05 | 第3節「学校経由・代表編集・各地区切出」・[rep:957](../tests/unit/rep.test.js#L957) `rep: exportSingleDistrictFromRep extracts single district with deep clone, PoLP security, and password flexibility (Action Item A-1)` | パスワード選択と案内/focusは [rep:1039](../tests/unit/rep.test.js#L1039) `rep: exportSingleDistrictFromRep gracefully handles "prompt() is not supported" environment and triggers rep-pass guidance UX` が検査する。 |
| E-03-06 | 第3節出席候補/自治会本人追跡・[rep:435](../tests/unit/rep.test.js#L435) `rep: renderSzNeighborhoodSelector and toggleSzNeighbor synchronization` | 会長初期チェック、同地区同期、外部削除取消を既存試験で追う。 |
| E-03-07 | 第3節「座席寸法・自由文・左右反転」と削除追跡各行 | ドラッグ&ドロップは仕様に含めず、select割当を検査する。 |
| E-03-08 | 第4節「代表12選択肢の実UI配線」「個別PDFと動的タイトル」 | 代表12種と地区個別保存の検査範囲を区別する。 |
| E-04-01 | 第2節「再起動復元・カード開閉・フォーム保持」「自治会CRUD・順序・空状態」 | 自治会名の入力/保存/実再起動を追う。 |
| E-04-02 | 第2節「自治会CRUD・順序・空状態」・[headless-workflows:189](../tests/system/headless-workflows.test.js#L189) | 行操作と上下追加を検査する。 |
| E-04-03 | 第4節「自治会名簿と名札の項目意味」、第8節名札組版 | 実OS印刷と折り精度は未検証である。 |
| E-04-04 | 第2節「読込パスワードの分離」「自治会年度更新」、第9節SEC-18、第11節保存カード構造 | モック上の存在検査を実DOMの一意性/包含/配置順/最下部配置で補完した。 |
| E-05-01 | 第2節「転入の提出必須項目」「兄弟姉妹・暗号出力・リセット」 | [headless-workflows:237](../tests/system/headless-workflows.test.js#L237) `UI transfer validation: blank ${field} blocks both file and clipboard` が空白必須値を検査する。 |
| E-05-02 | 第5節提出暗号・[transfer:101](../tests/unit/transfer.test.js#L101) `exportTransferTxt and copyTransferEncryptedText generate valid transfer payload` | ファイル名の姓、`isTransferData` と児童値の復号を検査する。 |
| E-05-03 | 第2節「兄弟姉妹・暗号出力・リセット」、上記転入101行 | コピーした暗号文を実復号し種別を検査する。 |
| E-05-04 | 第2節「URL共有と利用者取消」、第9節アプリURL非漏洩 | `mode=transfer` を確認する。OS共有先の実配送は未検証である。 |
| E-05-05 | 第2節「兄弟姉妹・暗号出力・リセット」・[headless-workflows:251](../tests/system/headless-workflows.test.js#L251) | 確認付きリセットと保存済み入力の消去を検査する。 |
| E-06-01 | 第3節PoLP/切出/地区設定保護 | 旗振り設定除外と対象地区限定に加え、第11節で正当な文字列 `savedFilePassword` の代表状態/保存/実復号出力への非伝搬を直接補完した。 |
| E-06-02 | 第3節自治会・転入の各統合行 | 不一致/重複/割当取消と既存名簿の不変を確認する。 |
| E-06-03 | 第3節一般ファイル転入振分と貼付復元、[security-render-coverage:84](../tests/unit/security-render-coverage.test.js#L84) `security representative: the master-restoration picker routes transfer data and cancels without changing existing records` | 代表マスター用pickerから転入と判定して専用処理へ渡すことを検査する。 |
| E-06-04 | 第9節SEC-18単体/UI | 先行Redで旧name/kana/余剰個人情報の残留を検知した。是正後対象限定Greenは全回帰合格と区別する。 |
| E-08-01 | 第5節パスワード・[headless-workflows:211](../tests/system/headless-workflows.test.js#L211) `UI passwords: ${mode} full-width sanitation, 11/12 chars, mismatch, visibility` | 各モードの11/12文字、全角、確認不一致、可視化を実DOMで検査する。 |
| E-08-02 | 第5節提出暗号・新旧形式・改竄、第9節実暗号化取込 | ファイル名/ヘッダーは暗号本文と異なり平文である。転入姓の出力は転入101行で確認する。 |
| E-08-03 | 第5節4モード暗号・原子的移行・全消去後の復活防止 | 未暗号化保存の平文を [storage-flow:16](../tests/integration/storage-flow.test.js#L16) でも検査する。 |
| E-08-04 | 第5節Web Locks不在・保存改竄と部分解除防止 | WebAuthnはAPI fixtureであり、実認証器は未検証である。 |
| E-08-05 | 第5節オプトイン・WebAuthn再利用・ロック、第3節PoLP、第11節秘密非伝搬 | 平文保存除外、代表の実保存/出力への非混入と年度更新時破棄を検査する。 |
| E-08-06 | 第5節ロック破棄・絶対期限・世代・他タブ各行 | 保存改竄・遅延復号で秘密値が部分表示されないことも検査する。 |
| E-09-01 | 第5節受入・型・容量・予約キー・日数・座席各行、第9節SEC-19 | 認証済みの中身も共通受入境界で検査する。 |
| E-09-02 | 第9節SEC-19端点/経路/下書き/補完年/明示休日 | 先行Redによる不具合検知と是正後対象限定Greenの記録である。全回帰・最終合否は別途確認する。 |
| E-09-03 | 第5節部分確定禁止・読込前後サイズ・遅延復号、第3節不正公式JSON、第9節拒否時保全 | 旧状態/DOM/保存値・file再選択・失敗貼付保持を別assertionで追う。 |
| E-09-04 | 第5節4系統のXSS・prototype・CSP、第9節CDP/公式JSON/共有非漏洩 | CDP観測はfile起動の対象ページ要求であり、HTTP配信と全ブラウザ通信を保証しない。 |

下位IDの未対応は0件である。初回索引化で判明したレスポンシブ配置と保存カード構造の不足は第11節で補完した。ID対応だけで全副条件を合格とせず、直接assertionと実行範囲を併せて確認する。

## 11. 下位仕様の照合で補足した構造・秘密非伝搬の検査

第8節の16件は維持し、次の5件を追加した。対象限定の同一コマンドを再実行し、単体16件とUI5件の計21/21合格を確認した。構造と座標を直接確認するため、DOMモックの自動ID生成やCSSクラス名の存在だけでは合格しない。

| 要件 / 外部 / 内部 | 追加テストの正確な名称 | 追加したassertion |
| :--- | :--- | :--- |
| R-08・R-17 / E-02-07 / I-05 | [headless-specification-contracts.test.js:59](../tests/system/headless-specification-contracts.test.js#L59) `UI specification flag settings: ${width}px copy controls and four metadata groups follow their responsive layout` | 375pxではコピー行のcomputed flex-direction=column、format/同一世帯まとめ/copy controlの存在と順番、正の矩形寸法・縦の非重複・左辺揃いを検査する。768/1280pxでは休日/特別枠/header/footerの4枠と各入力の対応、computed2列、上段/下段の行と列座標、非重複を検査する計3件である。 |
| R-02・R-03・R-04・R-17 / E-02-08・E-03-01・E-04-04 / I-05 | [headless-specification-contracts.test.js:100](../tests/system/headless-specification-contracts.test.js#L100) `UI specification saving cards: district, representative and neighbor have four ordered sections inside the final workflow card` | 実モード切替/カード展開後、各保存カードがtab直下の最後のcard、全4sectionが同一card-body直下に正しい順序で存在、IDは文書内で一意、区分ごとの実password/import/export/year controlの包含、表示矩形の正の寸法と上下非重複を3モードすべてで検査する1件である。 |
| R-07・R-13・R-15 / E-06-01・E-08-05 / I-03・I-04 | [specification-contracts.test.js:160](../tests/unit/specification-contracts.test.js#L160) `specification aggregation privacy: an imported remembered district password never reaches representative storage or decrypted master and split handoffs` | 正当な記憶パスワードと名簿を実暗号化して一般ファイル取込へ通し、名簿受理を確認したうえで代表状態・LocalStorage・実復号マスター・実復号切出からプロパティと秘密canaryを除外する。元地区オブジェクトと秘密は保持し、切出明示鍵は代表入力鍵より優先し、代表入力鍵では切出が復号できないことも確認する。 |

## 12. 最終全回帰と品質ゲート

今回の最終実測は `npm test` 709/709、`npm run test:ui` 111/111であり、いずれも失敗・取消・スキップ0件である。追加した保存パスワード非混入の1件を含む。12本番モジュールはすべてLine 100%、Branch 95.27〜100%、Funcs 98.55〜100%であり、要求閾値を満たす。実行環境と全モジュールの値は[検証記録](reviews/review59_specifications_verification.md)、独立判定は[テストGate 2](reviews/review58_specification_tests.md)と[最終Gate 3](reviews/review60_specifications_security_final.md)に記録する。

本表で今回特定したアサーション不足は第8・9・11節の追加テストで補完した。公開配信・実認証器・OS印刷/共有先の境界は、これらの数値をもって検証済みとはしない。
