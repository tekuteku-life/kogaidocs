# 要件・外部仕様・内部仕様とテストのトレーサビリティ

**作成日**: 2026年10月24日（2026年11月19日・11月20日・11月21日 2.12.1 追補、11月22日 試験の参照の行番号の修正）<br>
**対象**: kogaidocs 2.12.1（過去の検証結果は各記録の対象版による）<br>
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
| R-17 / E-01 / I-01 | 4モード・URL優先・数値別名 | [headless-workflows.test.js:59](../tests/system/headless-workflows.test.js#L59) `UI navigation: mode=${queryMode} restores with URL priority` | 4名称・1〜4・invalidを別ケースとし、各画面の可視性と `kogai_active_mode` を検査する。invalid時は既存neighborを使用する。 |
| R-17 / E-01 / I-01 | 再起動復元・カード開閉・フォーム保持 | [headless-workflows.test.js:70](../tests/system/headless-workflows.test.js#L70) `UI navigation: clicks, card CSS, input retention and actual reload` | 折りたたみ時に入力を不可視とし、ヘッダーで展開する。4モード往復後の地区名、実再読込後の自治会名とモードを確認する。 |
| R-17 / E-01 / I-06 | URL共有と利用者取消 | [headless-workflows.test.js:746](../tests/system/headless-workflows.test.js#L746) `UI app share: native share, cancellation, clipboard and prompt fallbacks` | `mode=transfer` を含む共有URL、AbortError時のコピー副作用なし、API不在時のコピー、コピー拒否時のprompt案内を確認する。OS共有先への実送信は行わない。 |
| R-17 / E-01 / I-05 | モバイル・タブレット・PC表示 | [headless-workflows.test.js:788](../tests/system/headless-workflows.test.js#L788) `UI responsive: ${width}px controls and hata layout remain reachable` | 375/768/1280pxで追加ボタン幅、名簿の横スクロール包含、旗振り表示形式、ページ全体の横はみ出しなしを検査する。 |
| R-02 / E-02 / I-03・I-04 | 班一覧と児童名簿CRUD・並べ替え | [headless-workflows.test.js:87](../tests/system/headless-workflows.test.js#L87) `UI district: top/bottom CRUD, sort order, han options, cancellation and summary` | 班名区切り正規化・重複排除・select更新、上下の行追加、直前の班継承、班長の先頭表示、学区外集計、削除取消/確定を確認する。 |
| R-02 / E-02 / I-03・I-04 | 校外役員複数登録・削除確認 | [headless-workflows.test.js:87](../tests/system/headless-workflows.test.js#L87) 上記テスト | 役員追加・氏名入力の状態反映、削除取消後2人保持・確定後1人を確認する。詳細フィールドは [district.test.js:29](../tests/unit/district.test.js#L29) `district: officers management (render, add, remove)` でも検査する。 |
| R-02 / E-02 / I-05 | 自治会取込パネルの開閉 | [district.test.js:748](../tests/unit/district.test.js#L748) `district: openNeighborImportPanel toggles panel, updates label, and sets aria-expanded (Action Item A-3)` | none/block、ボタン表示、`aria-expanded`、カード展開を確認する。単なる関数呼出回数の検査ではない。 |
| R-02 / E-02 / I-05 | 転入取込パネルの開閉 | [district.test.js:907](../tests/unit/district.test.js#L907) `district: toggleTransferImportPanel toggles panel, updates label, and sets aria-expanded (Action Item A-3)` | 表示切替・aria・展開を確認する。実UI経路は後述の転入統合テストが利用する。 |
| R-02 / E-02 / I-04 | 年度更新の進級・卒業・個人情報消去 | [headless-workflows.test.js:486](../tests/system/headless-workflows.test.js#L486) `UI district year: cancel, grade 1/5/6 boundaries, officer/password purge and hata reset` | 取消時の状態保持、1→2年・5→6年・6年卒業、パスワード欄の消去、旗振りの場所保持と期間消去を確認する。役員・保存パスワードの破棄は `system [パスワード安全記憶]: opt-in persistence, unencrypted storage exclusion, lock wipe, and rollover` と地区の年度更新単体試験に対応する。 |
| R-03 / E-03 / I-04・I-05 | 地区手動追加モーダル | [headless-workflows.test.js:128](../tests/system/headless-workflows.test.js#L128) `UI rep add modal: whitespace, duplicate, error clearing, Enter, Escape and backdrop` | autofocus、空欄・空白・重複拒否、エラー消去、Enterで追加、Escape/背景で閉じる、内容クリックで保持、受理1件だけ保存を確認する。 |
| R-03 / E-03 / I-04 | 集約詳細編集・下書き保存/取消 | [headless-workflows.test.js:163](../tests/system/headless-workflows.test.js#L163) `UI rep detail: all row types, draft discard/save and confirmed deletion` | 役員・児童・自治会行の編集、削除取消、保存後の本状態・集約表示、取消時の本状態不変、保存後の下書き解放を確認する。 |
| R-03 / E-03 / I-04 | 代表の年度更新・組織枠保持 | [headless-workflows.test.js:510](../tests/system/headless-workflows.test.js#L510) `UI neighbor and representative year update: cancel and retain organizational templates only` | 取消、個人情報削除と地区/役職等のテンプレート保持を検査する。 |
| R-04 / E-04 / I-04 | 自治会CRUD・順序・空状態 | [headless-workflows.test.js:192](../tests/system/headless-workflows.test.js#L192) `UI neighbor: add, reorder boundaries, delete cancellation, zero-row state` | 上下の追加、先頭/末尾の移動境界、移動後の順序、削除取消、0行時の描画を確認する。 |
| R-04 / E-04 / I-05 | 自治会の保存カード4区分 | [neighbor.test.js:437](../tests/unit/neighbor.test.js#L437) `neighbor: integrated card (#card-n-file) 4 major sections exist` | `sec-n-pass/save-share/load/year` の存在をDOMモックでassertする。ただしモックは未登録IDを自動生成するため、実HTMLの4区分欠落・包含関係・配置順の検知を保証しない。操作結果は暗号化入出力・年度更新のUI試験へ対応する。 |
| R-04 / E-04 / I-02・I-04 | 読込パスワードの分離 | [neighbor.test.js:366](../tests/unit/neighbor.test.js#L366) `neighbor: loadNeighborTxt and loadPastedTextToNeighbor prioritize #neighbor-import-pass and ignore #neighbor-pass` | ファイル/貼付の復号に読込専用パスワードを渡し、保存用入力が復号パスワードに混入しないことを確認する。 |
| R-04 / E-04 / I-04 | 自治会年度更新 | [neighbor.test.js:297](../tests/unit/neighbor.test.js#L297) `neighbor: runNeighborYearUpdate resets personal info and keeps roles` | 役職は残し氏名/連絡先等を消去する。実UIの取消/確定は上記510行の試験でも確認する。 |
| R-05 / E-05 / I-03 | 転入の提出必須項目 | [transfer.test.js:433](../tests/unit/transfer.test.js#L433) `exportTransferTxt and copyTransferEncryptedText require address and tel (mandatory fields)` | 住所/電話の欠落時はファイルとコピーを拒否し、全必須値がある場合に出力する。氏名・0件は [transfer.test.js:197](../tests/unit/transfer.test.js#L197) `exportTransferTxt and copyTransferEncryptedText validate empty children and invalid password` と対応する。 |
| R-05 / E-05 / I-04 | 兄弟姉妹・暗号出力・リセット | [headless-workflows.test.js:255](../tests/system/headless-workflows.test.js#L255) `UI transfer: sibling inheritance, encryption download/copy, cancel/delete and reset` | 家庭連絡先の共有、実暗号文の復号内容、コピー、削除取消、リセットを確認する。 |
| R-05 / E-05 / I-03 | 未入力下書き保存 | [security-state.test.js:55](../tests/unit/security-state.test.js#L55) `security: an empty transfer draft is valid local data despite submission requirements` | `{children: [], memo: '下書き'}` を復元できることを検査し、提出要件と保存要件の誤混同を防止する。 |

## 3. 統合・旗振り・座席の追跡

| 要件 / 外部 / 内部 | 確認項目 | 根拠テスト（定義位置・正確なテスト名） | 実際に確認する assertion・境界 |
| :--- | :--- | :--- | :--- |
| R-06 / E-06 / I-04 | 自治会→地区→代表 | [neighbor-merge.test.js:16](../tests/integration/neighbor-merge.test.js#L16) `integration: Pattern A (Standard Order) - Neighbor Export -> District Merge -> District Export -> Rep Import` | 実暗号化出力から地区の自治会置換と既存児童/役員保持、地区出力後の代表受入を確認する。 |
| R-06 / E-06 / I-04 | 自治会先着/後着と複数班 | [neighbor-merge.test.js:126](../tests/integration/neighbor-merge.test.js#L126) `integration: Pattern B (Neighborhood Direct to Rep First) -> District File Follows with Neighborhood Protection`、[同194行](../tests/integration/neighbor-merge.test.js#L194) `integration: Pattern C (District First, Neighborhood Second in Rep Mode)`、[同254行](../tests/integration/neighbor-merge.test.js#L254) `integration: Pattern D (Multi-Han District Sync & Deduplication)` | 入力順の違い、先行自治会の保護、同名地区の複数班への同期と重複排除を確認する。 |
| R-06 / E-06 / I-04 | 自治会ファイル/貼付と地区名不一致 | [headless-workflows.test.js:326](../tests/system/headless-workflows.test.js#L326) `UI neighborhood pipeline: encrypted file/paste and mismatch cancellation preserve other rosters` | UIボタンで実暗号文を取り込み、自治会だけ更新、児童/役員の不変、不一致確認の取消で保全を確認する。 |
| R-06 / E-06 / I-04 | 転入→地区・班選択・重複取消 | [headless-workflows.test.js:286](../tests/system/headless-workflows.test.js#L286) `UI pipeline: transfer file to district, cancelled duplicate, representative split and hata preservation` | 暗号出力から地区へ実ファイル取込、班割当、重複取消、代表切出と地区復元を確認する。 |
| R-06 / E-06 / I-04 | 転入→代表直接 | [headless-workflows.test.js:816](../tests/system/headless-workflows.test.js#L816) `UI rep transfer direct: file picker assigns district and han; cancellation is atomic` | 一般ファイル選択から転入と識別し地区/班へ割当、取消時に既存名簿を保持する。 |
| R-06 / E-06 / I-04 | 学校経由・代表編集・各地区切出 | [transfer-integration.test.js:189](../tests/integration/transfer-integration.test.js#L189) `integration: Pattern E - School Route: Transfer Export -> Rep Direct Import -> Rep Split-Export -> District Load` | 転入出力、代表での受入と編集、切出した地区ファイルの復号・地区読込までを確認する。実際の学校/メール配送は対象外である。 |
| R-06 / E-06 / I-03・I-04 | 複数ファイル集計・代表マスター復元 | [district-rep-sync.test.js:16](../tests/integration/district-rep-sync.test.js#L16) `integration: district -> rep multi-file sync, student aggregation, neighborhood dedup, seat allocation, master export/import` | 3ファイル、同地区5児童・学年別/学区外集計、自治会2地区、役員参照4件の一意性、座席を含むマスター復元を検査する。 |
| R-06 / E-06 / I-04 | 地区貼付復元・代表貼付復元 | [headless-workflows.test.js:802](../tests/system/headless-workflows.test.js#L802) `UI district paste restore: actual button restores file content and local flag settings`、[同1024行](../tests/system/headless-workflows.test.js#L1024) `UI representative master: exported master restores through the paste control` | ファイルだけでなく実貼付コントロールから復元し、地区の既存旗振り設定と代表マスターの内容を確認する。 |
| R-07 / E-06 / I-04 | 旗振り最小権限・往復保護 | [hata-polp-integration.test.js:14](../tests/integration/hata-polp-integration.test.js#L14) `integration: Pattern F - Hatafurotto PoLP boundary defense & round-trip district protection` | 代表状態・復号マスター・切出ファイルに `hata` がなく、旧 `hatafurotto` も除外されること、地区復元で免除/手動調整を保持することを検査する。 |
| R-07 / E-06 / I-04 | 両側に旗振りがある場合の上書き確認 | [district.test.js:1129](../tests/unit/district.test.js#L1129) `district: loadDistrictTxt protects existing hata when incoming has no hata, and confirms override when both have hata (A-3)` | incomingに設定がない場合の保持、両側にある場合の確認/取消を分岐ごとに検査する。 |
| R-08 / E-02 / I-04 | 世帯の正規化・兄弟統合 | [hata.test.js:89](../tests/unit/hata.test.js#L89) `hata: extractHouseholdsFromStudents extracts normalized households and deduplicates siblings (A-1)`、[同137行](../tests/unit/hata.test.js#L137) `hata: extractHouseholdsFromStudents handles edge cases of addresses without numbers, different last names at same address, etc. (T-4 / GAP-TG-5)` | 全角番地の正規化、同一世帯の児童2人、同住所の別姓、番地なし、空住所の世帯キーを検査する。 |
| R-08 / E-02 / I-04 | 祝日・年度期間プリセット | [hata.test.js:107](../tests/unit/hata.test.js#L107) `hata: generateJapaneseHolidays calculates Japanese national holidays accurately (GAP-TEST-3)`、[同158行](../tests/unit/hata.test.js#L158) `hata: getPeriodPresetDates calculates accurate period dates based on reference year` | 2026年の固定/振替/ハッピーマンデー/春秋分と2028年の閏年、前期/後期/通年の日付を検査する。将来の法改正を自動追従する保証ではない。 |
| R-08 / E-02 / I-04 | 当番生成・免除・特別日・手動調整 | [hata.test.js:172](../tests/unit/hata.test.js#L172) `hata: generateHataSchedule allocates duties evenly and respects exclusions & overrides`、[同216行](../tests/unit/hata.test.js#L216) `hata: swapScheduleDates and setDateOverride modifies schedule and updates manualOverrides` | 特別日優先、休日person=`-`、免除世帯の非割当、手動指定と交換結果/overrideを確認する。通常当番の担当数差に対するassertionは不足しているため、均等性まで確認済みとは判定しない。 |
| R-08 / E-02 / I-04・I-05 | 設定・休日復元と実再起動 | [headless-workflows.test.js:538](../tests/system/headless-workflows.test.js#L538) `UI hata: imported holidays survive DOM/state/storage/schedule and actual reload`、[同1043行](../tests/system/headless-workflows.test.js#L1043) `UI hata holiday arrays: normalize, use, save and restore after reload` | 休日のDOM/状態/保存/生成表への反映、配列形式の正規化と実再読込を検査する。 |
| R-08 / E-02 / I-03・I-04 | 不正公式JSONと同一ファイル再選択 | [headless-workflows.test.js:554](../tests/system/headless-workflows.test.js#L554) `UI hata: malformed JSON is reported, state preserved and same file retry enabled` | 空/構文不正/型不正を拒否し旧設定・通知・file input空復帰を検査する。 |
| R-08 / E-02 / I-04・I-05 | 公式JSON読込と印刷 | [hata.test.js:242](../tests/unit/hata.test.js#L242) `hata: official JSON import preserves supported settings`、[headless-workflows.test.js:583](../tests/system/headless-workflows.test.js#L583) `UI hata: generation, exemption, stats, import-only controls, print title and cleanup` | JSON取込と地区暗号化ファイルの設定値、実UIで特別日・休日・統計表示、JSON値、印刷タイトル、作業用印刷DOM消去を確認する。 |
| R-09 / E-03 / I-04 | 出席者の座席候補 | [seat.test.js:12](../tests/unit/seat.test.js#L12) `seat: getAllSzParticipantsForSeat lists facility, officers, neighborhood, and externals` | 印刷対象地区の役員/自治会と出席externalだけを候補とし、未選択地区・欠席者を除外する。施設マーカーも確認する。 |
| R-09 / E-03 / I-03・I-04 | 座席寸法・自由文・左右反転 | [headless-workflows.test.js:616](../tests/system/headless-workflows.test.js#L616) `UI seat editor: min/max resize, facility/custom text, side labels, attendance selection` | 2〜10列・2〜14行、実DOMセル数、施設・自由文、会場ラベル、左右反転、欠席による候補除外を確認する。ドラッグ&ドロップを確認したテストではない。 |
| R-09 / E-03 / I-04 | 外部関係者削除と本人追跡 | [headless-workflows.test.js:640](../tests/system/headless-workflows.test.js#L640) `UI seat deletion: removing another external attendee preserves assigned person` | A削除後もBを割当て、B削除時だけ解除し、取消時の配列保持を確認する。 |
| R-09 / E-03 / I-04 | 地区/校外役員削除の参照繰下げ | [headless-workflows.test.js:656](../tests/system/headless-workflows.test.js#L656) `UI seat deletion: removing preceding district/officer keeps other assignments` | 前方の地区と役員を削除しても後方の役員Bへ座席が残ることを実select表示で確認する。 |
| R-09 / E-03 / I-04 | 自治会削除と出席チェック追跡 | [headless-workflows.test.js:850](../tests/system/headless-workflows.test.js#L850) `UI rep neighbor deletion: selected attendance and seat follow surviving officer` | 自治会行の削除に伴う出席・座席の本人継続を検査する。曖昧な同名地区の参照解除は [ui-regressions.test.js:168](../tests/unit/ui-regressions.test.js#L168) `regression: print selection refreshes seat options and safe ambiguity clears assignments` と対応する。 |

## 4. 帳票の追跡

代表の12種類は `officers_pta/officers_school/reg_tent/envelopes/all_students/all_neighbors/sz_tent/sz_att_1/sz_att_2/sz_att_3/sz_seats/sz_master` である。旗振り表は地区の別系統であり、この12種類に加算しない。

| 要件 / 外部 / 内部 | 確認項目 | 根拠テスト（定義位置・正確なテスト名） | 実際に確認する assertion・境界 |
| :--- | :--- | :--- | :--- |
| R-10 / E-07 / I-05 | PTA用の連絡先限定 | [print.test.js:118](../tests/unit/print.test.js#L118) `print: buildPtaOfficersRosterPageHtml formats PTA roster with contact info for core roles` | 代表氏名・電話と一般役員氏名の存在を検査する。一般役員の電話/メール/住所の非出力はこの既存試験ではassertしておらず、補足対象である。 |
| R-10 / E-07 / I-05 | 学校用の児童・地区集計 | [print.test.js:133](../tests/unit/print.test.js#L133) `print: buildSchoolOfficersRosterPageHtml formats school submission roster with district counts` | 地区・役員/児童氏名、学年/組、住所・電話を検査する。地区集計の根拠は結合試験 `integration: district -> rep multi-file sync, student aggregation, neighborhood dedup, seat allocation, master export/import` と組み合わせる。 |
| R-10 / E-07 / I-05 | 児童名簿の連絡先非表示・班・集計 | [print.test.js:39](../tests/unit/print.test.js#L39) `print: buildStudentPageHtml handles privacy options, multi-han, and district-wide totals` | 電話/メール表示のON/OFF、複数班、地区全体の集計、空名簿を検査する。 |
| R-10 / E-07 / I-05 | 四つ折り名札・封筒12面 | [print.test.js:29](../tests/unit/print.test.js#L29) `print: buildTentCardPageHtml generates origami 4-panel layout with fold lines`、[同166行](../tests/unit/print.test.js#L166) `print: buildEnvelopesPagesHtml formats 3x4 grid with child delivery note` | 名札の氏名/かな/役職/折線マーカー、封筒ページ数1・gridマーカー・宛名・児童への配達文言を確認する。四面数・180度反転・3×4寸法・12面境界はこの既存試験のassertionには含まれない。 |
| R-10 / E-07 / I-05 | 自治会名簿と名札の項目意味 | [print.test.js:99](../tests/unit/print.test.js#L99) `print: buildNeighborPageHtml handles empty and populated neighborhood roster`、[headless-workflows.test.js:703](../tests/system/headless-workflows.test.js#L703) `UI neighbor tent cards: semantic name/kana/role and no-rows guard` | 氏名・かな・役職が正しいDOMへ出力され、自治会名を含むタイトルとなることを確認する。空印刷拒否は [neighbor.test.js:326](../tests/unit/neighbor.test.js#L326) でも検査する。 |
| R-10 / E-07 / I-05 | スクゾ名札・出席簿3種・座席・控え | [print.test.js:191](../tests/unit/print.test.js#L191) `print: buildSzTentCardsPagesHtml generates cards for all attendee groups`、[同199行](../tests/unit/print.test.js#L199) `print: buildSzAttendance sheets and seat chart generators` | 出席者分類、出席簿名、座席と関係者一覧の内容を検査する。 |
| R-10 / E-07 / I-05 | 代表12選択肢の実UI配線 | [headless-workflows.test.js:716](../tests/system/headless-workflows.test.js#L716) `UI representative print: all twelve report choices render, selection controls and empty guard` | 12選択肢それぞれが印刷を1回呼び出し印刷ページを生成すること、全選択と地区対象の切替、空選択拒否を検査する。各帳票の意味内容は上記単体試験と [print-pipeline.test.js:16](../tests/integration/print-pipeline.test.js#L16) `integration: end-to-end print pipeline (single district & representative bulk 12 document types)` で補完する。 |
| R-10 / E-07 / I-05 | 個別PDFと動的タイトル | [headless-workflows.test.js:679](../tests/system/headless-workflows.test.js#L679) `UI print: selected district documents, opt-out contacts, separate titles, empty selection` | 氏名保持、電話/メール非表示、選択2帳票の別々のタイトルと呼出、元タイトル復元、空選択ガイドを確認する。ブラウザ標準ダイアログで実PDFを保存した証拠ではない。 |
| R-08・R-10 / E-07 / I-05 | 旗振り専用組版・旧帳票混入防止 | [hata.test.js:727](../tests/unit/hata.test.js#L727) `hata: genuine Hatafurotto A4 multi-column print layout and empty padding rows (A-1, A-2, A-4, A-5, T-1, T-2)`、[headless-workflows.test.js:890](../tests/system/headless-workflows.test.js#L890) `UI printing CSS: old ordinary reports do not leak into hata print, landscape applies` | 多段/空行パディング/欄構造と、print media下の通常帳票非表示、landscape適用、後始末を確認する。 |

## 5. 暗号化・ロック・取込セキュリティの追跡

| 要件 / 外部 / 内部 | 確認項目 | 根拠テスト（定義位置・正確なテスト名） | 実際に確認する assertion・境界 |
| :--- | :--- | :--- | :--- |
| R-11 / E-08 / I-02 | 新規提出600,000回・形式2 | [security-kdf.test.js:98](../tests/unit/security-kdf.test.js#L98) `SEC-12: new submission payload uses ENC:2: and 600,000 PBKDF2 iterations` | 実暗号文を独立したWebCrypto処理で復号し、形式と反復回数を検証する。 |
| R-11 / E-08 / I-02 | 旧提出互換・未知形式拒否 | [security-kdf.test.js:110](../tests/unit/security-kdf.test.js#L110) `SEC-12: independently generated ${prefix \|\| 'bare Base64'} submission decrypts using ${iterations} iterations`、[同118行](../tests/unit/security-kdf.test.js#L118) `SEC-12: unknown submission version is rejected before PBKDF2`、[同126行](../tests/unit/security-kdf.test.js#L126) `SEC-12: a new-format authentication failure never retries the legacy KDF` | 新旧形式・接頭辞なし互換、未知版のKDF開始前拒否、認証失敗後の旧形式フォールバック禁止を確認する。 |
| R-12 / E-08 / I-02 | 4モード保存暗号・実再起動解除 | [headless-workflows.test.js:370](../tests/system/headless-workflows.test.js#L370) `UI encryption migration: all four modes encrypted, reload locks, wrong/correct unlock restores` | 各保存値が暗号文となり、再起動はロック、誤パスワード拒否、正しい解除で4モード復元する。 |
| R-12 / E-08 / I-02 | 保存暗号文AAD・保存先交換 | [security-crypto.test.js:173](../tests/unit/security-crypto.test.js#L173) `security crypto: new ciphertext authenticates its version and storage slot for every mode`、[同195行](../tests/unit/security-crypto.test.js#L195) `security crypto: ciphertext from ${origin} cannot authenticate as ${target}` | 全モードの形式/AAD、別キーへの暗号文差替え拒否を実暗号化で検査する。 |
| R-12 / E-08 / I-02 | 原子的移行と失敗時ロールバック | [security-kdf.test.js:198](../tests/unit/security-kdf.test.js#L198) `SEC-12: format ${format} metadata commit failure restores every original saved value`、[同214行](../tests/unit/security-kdf.test.js#L214) `SEC-12: combined old-format migration rolls back after the third data write fails` | 旧形式の各データと認証情報を移行し、データ書込途中/メタ情報確定失敗時に全原本を保持する。 |
| R-12 / E-08 / I-02 | 同キー保存順序 | [security-crypto.test.js:359](../tests/unit/security-crypto.test.js#L359) `security crypto: reversed encryption completion cannot replace the latest value with an older save` | 暗号化の完了順が逆転しても最新データが残ることを確認する。 |
| R-12 / E-08 / I-02 | 別コンテキスト排他・全消去 | [security-crypto.test.js:424](../tests/unit/security-crypto.test.js#L424) `security crypto locks: clear requested between setup commit keys waits and leaves every storage key empty`、[同495行](../tests/unit/security-crypto.test.js#L495) `security crypto locks: ordinary encrypted save serializes with ${action} in another tab` | 共通保存領域を共有する別モジュールコンテキストと共有Web Locks fixtureで割込を再現し、複数キー確定/ロールバックと他操作が重ならないことを検査する。実ブラウザ2タブのOSスケジューリングそのものではない。 |
| R-12 / E-08 / I-02 | Web Locks不在時の降格禁止 | [security-crypto.test.js:653](../tests/unit/security-crypto.test.js#L653) `security crypto locks: unavailable Web Locks rejects protected ${action} without altering storage`、[同673行](../tests/unit/security-crypto.test.js#L673) `security crypto locks: unavailable Web Locks still permits unencrypted single-key save, load and complete deletion` | 保護済み操作の保存不変・拒否、未暗号化単一キーの保存/読込/消去だけ許可することを検査する。 |
| R-13 / E-08 / I-02・I-05 | 12文字・一致・可視化・全角正規化 | [utils.test.js:176](../tests/unit/utils.test.js#L176) `utils: validatePassword() enforces security rules`、[同193行](../tests/unit/utils.test.js#L193) `utils: togglePasswordVisibility() toggles password input type and button text`、[同388行](../tests/unit/utils.test.js#L388) `utils: sanitizePasswordInput normalizes full-width characters and preserves caret position` | 最小長と非ASCII拒否、表示切替、全角ASCII変換・除去前後のキャレットを検査する。各モードの不一致確認は個別validator試験へ対応する。 |
| R-13 / E-08 / I-02 | 保存パスワードのオプトインと平文排除 | [system-matrix.test.js:688](../tests/system/system-matrix.test.js#L688) `system [パスワード安全記憶]: opt-in persistence, unencrypted storage exclusion, lock wipe, and rollover` | 暗号化解除時の同意保持、未暗号化時の `savedFilePassword` 除外、ロック/年度更新消去を確認する。 |
| R-13 / E-08 / I-02 | WebAuthn既存保護の再利用 | [app.test.js:903](../tests/unit/app.test.js#L903) `app: WebAuthn unification - quickSetupEncryptionFromCard suppresses credentials.create when storage encryption is already active` | 既存暗号化を利用し `credentials.create` を再実行しないことを確認する。実認証器のパスキー上書き仕様の保証ではない。 |
| R-13 / E-08 / I-02 | 生鍵の成功/例外時ゼロ化 | [security-crypto.test.js:304](../tests/unit/security-crypto.test.js#L304) `security crypto: wrapping failure zeroes the exported setup key`、[同315行](../tests/unit/security-crypto.test.js#L315) `security crypto: rejected biometric registration zeroes the exported active master key`、[同327行](../tests/unit/security-crypto.test.js#L327) `security crypto: ${method} unwrapped raw key is wiped when CryptoKey import fails` | 捕捉したraw bufferが失敗時にも0となることを確認する。JavaScriptコピーやGCまでの完全消去保証ではない。 |
| R-14 / E-08 / I-02・I-04 | ロック時の全状態・全DOM破棄 | [headless-workflows.test.js:402](../tests/system/headless-workflows.test.js#L402) `UI lock purge: all state, draft modal, print, plaintext/paste and revealed password fields` | 4モード、旗振り、代表下書き、印刷DOM、貼付、text型へ表示変更したパスワードを消去する。 |
| R-14 / E-08 / I-02 | 自動ロック期限・復帰時の先行判定 | [security-core-coverage.test.js:218](../tests/unit/security-core-coverage.test.js#L218) `security core: an early timer callback reschedules, while the absolute deadline purges before UI activity`、[同245行](../tests/unit/security-core-coverage.test.js#L245) `security core: visibility return and timer expiry enforce the same deadline; irrelevant storage events do not lock` | タイマー前倒し時の再設定、絶対期限経過、表示復帰、無関係storageイベントの区別を確認する。 |
| R-14 / E-08 / I-02 | 処理中ロック・遅延復号拒否 | [headless-workflows.test.js:1000](../tests/system/headless-workflows.test.js#L1000) `UI pending decrypt: lock prevents late import from restoring purged personal data` | 取込中にロックし、後から復号が完了しても本状態/DOMを復活させないことを確認する。 |
| R-14 / E-08 / I-02 | 全消去後の自動保存復活禁止 | [headless-security.test.js:312](../tests/system/headless-security.test.js#L312) `Security storage generation: an autosave queued after clear cannot restore erased data as plaintext` | 実ブラウザWeb Locksに保存を待機させ、全消去後は `false`、認証/地区キーnull、旧秘密値が全保存域にないことを検査する。 |
| R-14 / E-08 / I-02 | 他タブ認証変更/全消去 | [security-state.test.js:356](../tests/unit/security-state.test.js#L356) `security: another tab changing authentication metadata purges live secrets immediately`、[同369行](../tests/unit/security-state.test.js#L369) `security: another tab clearing all LocalStorage purges every live model and private DOM`、[同395行](../tests/unit/security-state.test.js#L395) `security: a tab protected before foreign LocalStorage.clear cannot resume plaintext writes` | auth変更/key=nullで全秘密破棄し、旧タブの平文書込を禁止する。 |
| R-15 / E-09 / I-03 | 全モード復元の一括受入 | [security-state.test.js:28](../tests/unit/security-state.test.js#L28) `security: saved models are validated before any of the four modes is committed`、[同43行](../tests/unit/security-state.test.js#L43) `security: malformed saved ${mode} rejects without committing any other mode` | 1モードでも不正なら他の正常モードも部分確定せず、保存値を保持する。 |
| R-15 / E-09 / I-03 | 任意機微項目・描画文字列の型 | [security-state.test.js:255](../tests/unit/security-state.test.js#L255) `security: district ${route} rejects a non-string saved password before changing state or DOM`、[同317行](../tests/unit/security-state.test.js#L317) `security: district ${route} rejects non-string hata.${field} before changing state or DOM` | ファイル/貼付の `savedFilePassword`、旗振りの `scheduleCreatedDate/district` の型不正を状態・DOM変更前に拒否する。保存復元の暗号化/平文は同ファイル277/288/329行でも検査する。 |
| R-15 / E-09 / I-03 | サイズ・深さ・配列・総ノード・予約キー | [security-state.test.js:91](../tests/unit/security-state.test.js#L91) `security: recursive import limits and reserved object properties reject without accepting prototypes`、[同106行](../tests/unit/security-state.test.js#L106) `security: UTF-8 JSON bytes, tree depth, array count and total node limits have exact accepted boundaries` | 予約キー拒否、JSON 4MiB・深さ20・配列10,000・総ノード100,000の境界を検査する。 |
| R-15 / E-09 / I-03 | ファイル8MiBの読込前/後検査 | [security-state.test.js:222](../tests/unit/security-state.test.js#L222) `security: oversized district and flag files are rejected before reading their bodies`、[同232行](../tests/unit/security-state.test.js#L232) `security: read completion enforces actual UTF-8 file size despite misleading File.size` | bodyを読む前の拒否と、不正なsize申告を含む内容側上限を確認する。 |
| R-15 / E-09 / I-03 | 旗振り範囲展開の計算量境界 | [security-date-boundary.test.js:90](../tests/unit/security-date-boundary.test.js#L90) `security date boundary: ${name} accepts exactly 3660 expansions at every model validator`、[同101行](../tests/unit/security-date-boundary.test.js#L101) `security date boundary: ${name} rejects 3661 expansions at every model validator` | 期間・休日・特別枠の3,660/3,661境界を共通validatorで検査し、ファイル/貼付/平文/暗号化/旧形式復元の保全試験へ展開する。 |
| R-15 / E-09 / I-05 | 地区の永続化型XSS | [headless-security.test.js:132](../tests/system/headless-security.test.js#L132) `Security district: encrypted hostile names survive import, save, reload and printing as text` | 実WebCryptoファイル→役員/児童DOM→保存→実再起動→印刷を通す。元文字列保持、実行フラグなし、攻撃img/form/styleなし、ロックDOMの重複なしを確認する。 |
| R-15 / E-09 / I-05 | 代表マスター・席注記のXSS | [headless-security.test.js:148](../tests/system/headless-security.test.js#L148) `Security representative: encrypted names and seat notes remain text after master restore and reload` | 外部組織名・役員名・席の自由文を実マスター取込/再起動/印刷へ通し、文字列保持と攻撃DOMなしを確認する。 |
| R-15 / E-09 / I-05 | 自治会ファイル・名札のXSS | [headless-security.test.js:173](../tests/system/headless-security.test.js#L173) `Security neighbor: encrypted hostile names survive file import, reload, roster and tent printing` | 自治会取込/保存/再起動/名簿/名札の双方で悪意氏名をテキストとして保持し、実行しないことを確認する。 |
| R-15 / E-09 / I-02・I-05 | 転入の暗号提出・XSS | [headless-security.test.js:194](../tests/system/headless-security.test.js#L194) `Security transfer: native form to real encrypted submission, district import, reload and print` | 暗号出力に平文児童名なし、復号した元文字列一致、地区取込・再起動・印刷で非実行を確認する。 |
| R-15 / E-09 / I-03・I-04 | prototype汚染と通常文字列の区別 | [headless-security.test.js:223](../tests/system/headless-security.test.js#L223) `Security prototype: official JSON assignee ${name} never mutates shared objects` | `__proto__/constructor/toString` を担当者文字列として公式JSON取込し、prototype/Object/組込関数のdescriptor不変、表示/集計の正常性を確認する。 |
| R-15 / E-09 / I-05 | CSP・固定アクション表 | [headless-security.test.js:236](../tests/system/headless-security.test.js#L236) `Security CSP: inline script, inline event, eval, base and form submissions are blocked`、[events-security.test.js:263](../tests/unit/events-security.test.js#L263) `events: unknown names and invalid parameters cannot resolve global functions or object properties` | script/event/eval/base/formそれぞれにCSP違反通知を待ち、実行フラグなしとbaseURI不変を検査する。未知アクション/不正引数から任意グローバルやプロパティを呼ばないことも検査する。 |
| R-15 / E-09 / I-02 | 改竄暗号文と部分解除防止 | [headless-security.test.js:263](../tests/system/headless-security.test.js#L263) `Security authentication: tampered ${mode} tag cannot unlock or expose partial restored state` | 4モードの実認証タグを破損、実再起動後の解除でエラー、ロック継続、全モデル/入力/印刷に秘密なし、破損原本不変を確認する。 |

## 6. 通信・PWA・品質の追跡

| 要件 / 外部 / 内部 | 確認項目 | 根拠テスト（定義位置・正確なテスト名） | 実際に確認する assertion・境界 |
| :--- | :--- | :--- | :--- |
| R-16 / E-01 / I-06 | 版確認・失敗・取消UI | [headless-workflows.test.js:768](../tests/system/headless-workflows.test.js#L768) `UI version settings: pending button, failure recovery, current/latest and cancellation` | 二重クリック防止、503失敗表示とボタン復帰、最新版/取消のフィードバックを検査する。fetch応答は置換している。 |
| R-16 / E-01 / I-06 | 更新ループ抑止・手動再試行 | [app.test.js:669](../tests/unit/app.test.js#L669) `app: checkAppVersion infinite update loop prevention safety guard with sessionStorage` | 直前更新対象の自動再通知抑止、手動の再確認許可、成功後の履歴消去を検査する。 |
| R-16 / E-01 / I-02・I-06 | 全保存を待って更新・保存失敗中止 | [security-state.test.js:140](../tests/unit/security-state.test.js#L140) `security: updating waits for every save before navigation`、[同182行](../tests/unit/security-state.test.js#L182) `security: rejected persistence prevents update and never reports a successful reload` | 4モード保存が完了するまで移動しないこと、失敗通知と更新中止を検査する。 |
| R-16 / E-01 / I-06 | 他アプリのcache/SW保護 | [security-state.test.js:199](../tests/unit/security-state.test.js#L199) `security: update clears only this scope cache and service worker registration` | 自scopeのcache接頭辞/scriptURL/scopeだけ削除し、同一originの別アプリを残すことを検査する。 |
| R-16 / E-01 / I-06 | SW install・公開資産の匿名取得 | [sw-security.test.js:127](../tests/system/sw-security.test.js#L127) `security SW: install precaches only public assets in its scope and activates successfully` | 許可静的資産の取得/保存、version/query除外、`credentials=omit/cache=no-store`、scope付きcache名を確認する。Request/Responseは標準実装、CacheStorageとnetworkはfixtureである。 |
| R-16 / E-01 / I-06 | SW cold/cached応答とruntime匿名取得 | [sw-security.test.js:154](../tests/system/sw-security.test.js#L154) `security SW: allowlisted static assets still support a cold fetch and a cached fetch`、[同166行](../tests/system/sw-security.test.js#L166) `security SW: runtime ${cached ? 'background refresh' : 'cold fetch'} is anonymous and bypasses the HTTP cache` | キャッシュした応答自体が返ることと、初回/バックグラウンド更新で元要求に依存せずomit/no-storeとなることを検査する。 |
| R-16 / E-01 / I-06 | SW不許可URL/要求の非保存 | [sw-security.test.js:231](../tests/system/sw-security.test.js#L231) `security SW: ${name} is never persisted` | version/query/未知URL/外部/別scope/Authorization/Cookie/credentials include/POSTの各入力で保存件数0を要求する。 |
| R-16 / E-01 / I-06 | SW非公開応答とfiltered Cookieの限界 | [sw-security.test.js:146](../tests/system/sw-security.test.js#L146) `security SW: install rejects ${name} responses before persisting any asset`、[同197行](../tests/system/sw-security.test.js#L197) `security SW: ${policy} remains non-cacheable when a browser hides Set-Cookie`、[同245行](../tests/system/sw-security.test.js#L245) `security SW: a ${policy} response cannot be persisted even at an asset URL` | private/no-storeと露出Cookie応答の保存0、非公開Cookieが見えなくても可視Cache-Controlで拒否することを確認する。匿名公開応答の安全性は配信契約も前提である。 |
| R-16 / E-01 / I-06 | SW別アプリcacheと旧cache隔離 | [sw-security.test.js:211](../tests/system/sw-security.test.js#L211) `security SW: an asset response in an unrelated cache cannot substitute for the current app cache`、[同253行](../tests/system/sw-security.test.js#L253) `security SW: a legacy cached private response is not served for an unknown URL`、[同261行](../tests/system/sw-security.test.js#L261) `security SW: activate deletes only stale caches belonging to the exact registration scope` | 他アプリ/旧private応答を返さず、自scopeの旧cacheだけ削除して別scopeと別アプリを保持することを確認する。 |
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
| R-08・R-15 / E-09-02 / I-03 / SEC-19 | [security-import-lifecycle.test.js:155](../tests/unit/security-import-lifecycle.test.js#L155) `security lifecycle: valid incomplete date draft ${JSON.stringify(config)} stays accepted and renderable` | 未指定・両端空・閏日のstartのみ/endのみの4件を受け入れ、描画例外なし、入力端点が保持されることを検査する。 |
| R-08・R-15 / E-09-02 / I-03 / SEC-19 | [security-import-lifecycle.test.js:166](../tests/unit/security-import-lifecycle.test.js#L166) `security lifecycle: year ${year} has a renderable bounded automatic holiday draft` | 0/1/99/100/1999/2000/2099/2100/9998/9999年の10件を実暗号化地区取込へ通す。成功通知、日付DOM、休日文字列、2000〜2099年内の実生成と2100年非混入、範囲外の空補完を検査する。日付の受入範囲と暦の自動生成範囲を区別する。 |
| R-08・R-15 / E-09-02 / I-03 / SEC-19 | [security-import-lifecycle.test.js:185](../tests/unit/security-import-lifecycle.test.js#L185) `security lifecycle: explicit holidays ${JSON.stringify(holidays)} survive an out-of-range calendar year`、[headless-lifecycle-security.test.js:109](../tests/system/headless-lifecycle-security.test.js#L109) `Security lifecycle UI: valid upper-year import survives real restart without invalid automatic holidays` | 単体2件で9999年の明示休日/明示空文字が保持されること、UI1件で9999年の実暗号化取込・実再起動後にも有効日付と空補完を維持することを検査する。 |
| R-01・R-15・R-17 / E-09-04・E-01-02・E-01-05 / I-05・I-06 | [headless-import-leakage.test.js:159](../tests/system/headless-import-leakage.test.js#L159) `Security leakage file: encrypted DOM file import, save, reload, print and app URL sharing (file origin)`、[同166行](../tests/system/headless-import-leakage.test.js#L166) `Security leakage paste: encrypted DOM paste import, save, reload, print and app URL sharing (file origin)` | file/貼付の2件で名簿・電話・パスワードcanaryを含む外部画像/相対URL画像/CSS/イベント風文字列を実暗号化取込し、保存/実再起動/通常帳票へ通す。元文字列保持、攻撃DOM/実行フラグ/CSP違反なし、共有とコピーへ渡るアプリURLに個人値・パスワード・暗号本文なしを検査する。 |
| R-08・R-15 / E-02-07・E-09-04 / I-03・I-04・I-05 | [headless-import-leakage.test.js:173](../tests/system/headless-import-leakage.test.js#L173) `Security leakage official JSON: hostile metadata, assignee and note survive file import, save, reload and Hata printing (file origin)` | 公式JSONのtitle/location/header/footer/contact/担当者/注記へ上記攻撃文字列を入れ、実ファイル取込、保存、実再起動、生成表、実一時印刷DOMまで全文を保持する。外部membersは児童名簿を置換せず、印刷DOMは後片付けされることを検査する。 |
| R-01・R-15 / E-09-04 / I-06 | [headless-import-leakage.test.js:133](../tests/system/headless-import-leakage.test.js#L133) 共通 `leakageTest` と [headless-runner.js:182](../tests/system/helpers/headless-runner.js#L182) CDP観測 | `observeNetwork` 時だけ対象ページsessionの `Network.requestWillBeSent` からURL/method/headers/postData/typeを収集する。3試験それぞれで初回/再読込の正常画像要求を捕捉する正の対照を要求し、収集要求のURL/ヘッダー/本文へ平文/URL符号化canaryなし、攻撃宛先なしを検査する。最大本文収集は1MiBであり、全ブラウザ・全形式・サーバー受信の証明ではない。 |

SEC-18/19先行Redの記録は64件中7件合格・57件失敗であり、本番修正前に既存不具合を検知した結果である。その後、是正後の対象限定実行64/64合格が統合担当から報告された。第8節の不足補足16件とは異なる集合であり、最終の全回帰件数やカバレッジ合格を意味しない。漏洩3件を含む最終結果は、全回帰・最終レビュー記録で確定する。

## 10. 外部仕様の下位項目索引と残る細部

第2〜9節は機能/攻撃経路単位の台帳であり、以下は外部仕様に定義された46個の下位IDすべてを、その台帳と根拠テストへ引き直す索引である。E-07には下位IDがなく、第4節の各帳票行と第8節で追跡する。下位IDへテストを対応させたことは、同じ行に記載する全副条件の完全検査を意味しない。未確認の細部は明示する。

| 外部仕様ID | 対応する確認項目・根拠位置 | 補足・不足 |
| :--- | :--- | :--- |
| E-01-01 | 第2節「4モード・URL優先・数値別名」・[headless-workflows:59](../tests/system/headless-workflows.test.js#L59) | URL/保存モードの優先と不正別名を検査する。 |
| E-01-02 | 第2節「URL共有と利用者取消」・[headless-workflows:746](../tests/system/headless-workflows.test.js#L746)、第9節漏洩観測 | アプリURL共有と名簿の意図した提出共有を区別する。 |
| E-01-03 | 第2節「再起動復元・カード開閉・フォーム保持」・[headless-chrome:6](../tests/system/headless-chrome.test.js#L6) | バッジ表示とクリック時の4選択肢展開を確認する。 |
| E-01-04 | 第2節「再起動復元・カード開閉・フォーム保持」・[headless-workflows:70](../tests/system/headless-workflows.test.js#L70) | 実再起動で選択モードを復元する。 |
| E-01-05 | 第2節「URL共有と利用者取消」・[headless-workflows:746](../tests/system/headless-workflows.test.js#L746)、第9節漏洩観測 | OS共有ダイアログとPWAインストール後の実配送は未検証である。 |
| E-01-06 | 第6節の版確認/ループ抑止/全保存/自scope/SW各行 | 公開HTTPSでの更新/SWオフライン実動作は未検証である。 |
| E-01-07 | 第2節の地区CRUD・代表詳細・自治会CRUD・転入操作、第3節座席削除各行 | [transfer:401](../tests/unit/transfer.test.js#L401) `removeTransferChildRow prompts confirmation when row has data and deletes only on OK (GAP-TEST-1)` は未入力下書きの例外も検査する。 |
| E-02-01 | 第2節「班一覧と児童名簿CRUD・並べ替え」・[headless-workflows:87](../tests/system/headless-workflows.test.js#L87) | 班正規化とselect候補を検査する。 |
| E-02-02 | 第2節「校外役員複数登録・削除確認」・[district:29](../tests/unit/district.test.js#L29) | [system-matrix:135](../tests/system/system-matrix.test.js#L135) `system [編集]: field editing, real-time title reflection, student multi-tier sort, and Hata template generation` がヘッダー反映を検査する。 |
| E-02-03 | 第2節「自治会取込パネルの開閉」、第3節「自治会ファイル/貼付と地区名不一致」 | 初期表示・上下追加・不一致取消・他名簿保持を複数ケースで追う。 |
| E-02-04 | 第2節「転入取込パネルの開閉」、第3節「転入→地区・班選択・重複取消」 | 入力ダイアログと班指定を通す。 |
| E-02-05 | 第2節「班一覧と児童名簿CRUD・並べ替え」・[utils:210](../tests/unit/utils.test.js#L210) `utils: compareStudents() correctly implements multi-tier sorting` | 班/役職/学年/住所/クラス/かなの比較結果を単体で補完する。 |
| E-02-06 | 第4節「個別PDFと動的タイトル」・[headless-workflows:679](../tests/system/headless-workflows.test.js#L679) | OSのPDF実保存は未検証である。 |
| E-02-07 | 第3節旗振りの全行、第2節375/768/1280px、第4節旗振り組版、第8節公平性、第9節公式JSON、第11節レスポンシブ補足 | 当番表の表示形式に加え、スマホコピー縦並び・PC設定欄2列×2段をcomputed styleと実座標で補完した。 |
| E-02-08 | 第2節年度更新、第3節貼付/設定保護、第5節記憶パスワード・[district:499](../tests/unit/district.test.js#L499) `district: shareDistrictData handles Web Share, LINE, Email, and Clipboard with URL length fallback`、第11節保存カード構造 | LINE/mail/Web Share/コピーと長文退避を検査する。実DOMの4区分/主要control/最下部配置も補完した。 |
| E-03-01 | 第2節代表操作、第3節代表集約/マスター、第5節認証、第9節年度更新、第11節保存カード構造 | [system-matrix:1055](../tests/system/system-matrix.test.js#L1055) の存在assertだけでは構造欠落検知が弱いため、実DOMの包含/順番/最下部配置を追加した。 |
| E-03-02 | 第3節「複数ファイル集計・代表マスター復元」「旗振り最小権限・往復保護」 | 復号されたマスターと切出し内容でもPoLPを検査する。 |
| E-03-03 | 第2節「地区手動追加モーダル」・[headless-workflows:128](../tests/system/headless-workflows.test.js#L128) | direct引数互換は [rep:1792](../tests/unit/rep.test.js#L1792) `rep: addNewRepDistrict with argument directly adds district, without argument opens modal` と対応する。 |
| E-03-04 | 第2節「集約詳細編集・下書き保存/取消」、第3節本人追跡 | 保存実行と通常クローズ/取消を区別する。 |
| E-03-05 | 第3節「学校経由・代表編集・各地区切出」・[rep:969](../tests/unit/rep.test.js#L969) `rep: exportSingleDistrictFromRep extracts single district with deep clone, PoLP security, and password flexibility (Action Item A-1)` | パスワード選択と案内/focusは [rep:1051](../tests/unit/rep.test.js#L1051) `rep: exportSingleDistrictFromRep gracefully handles "prompt() is not supported" environment and triggers rep-pass guidance UX` が検査する。 |
| E-03-06 | 第3節出席候補/自治会本人追跡・[rep:447](../tests/unit/rep.test.js#L447) `rep: renderSzNeighborhoodSelector and toggleSzNeighbor synchronization`・第17節 | 同地区同期（同じ本人の行への同期、名簿のないエントリどうしの行番号同期）、外部削除取消を既存試験で追う。名簿が同じエントリの行番号同期（重複行を含む）、名簿の異なるエントリの本人単位の同期、会長初期チェック（E-13-01 の役職の完全一致）、名簿差替え時の扱いは第17節（E-13-01・E-13-02・I-13-02）で追う。 |
| E-03-07 | 第3節「座席寸法・自由文・左右反転」と削除追跡各行 | ドラッグ&ドロップは仕様に含めず、select割当を検査する。 |
| E-03-08 | 第4節「代表12選択肢の実UI配線」「個別PDFと動的タイトル」 | 代表12種と地区個別保存の検査範囲を区別する。 |
| E-04-01 | 第2節「再起動復元・カード開閉・フォーム保持」「自治会CRUD・順序・空状態」 | 自治会名の入力/保存/実再起動を追う。 |
| E-04-02 | 第2節「自治会CRUD・順序・空状態」・[headless-workflows:192](../tests/system/headless-workflows.test.js#L192) | 行操作と上下追加を検査する。 |
| E-04-03 | 第4節「自治会名簿と名札の項目意味」、第8節名札組版 | 実OS印刷と折り精度は未検証である。 |
| E-04-04 | 第2節「読込パスワードの分離」「自治会年度更新」、第9節SEC-18、第11節保存カード構造 | モック上の存在検査を実DOMの一意性/包含/配置順/最下部配置で補完した。 |
| E-05-01 | 第2節「転入の提出必須項目」「兄弟姉妹・暗号出力・リセット」 | [headless-workflows:240](../tests/system/headless-workflows.test.js#L240) `UI transfer validation: blank ${field} blocks both file and clipboard` が空白必須値を検査する。 |
| E-05-02 | 第5節提出暗号・[transfer:103](../tests/unit/transfer.test.js#L103) `exportTransferTxt and copyTransferEncryptedText generate valid transfer payload` | 個人名を含まない固定ファイル名、`isTransferData` と児童値の復号を検査する。 |
| E-05-03 | 第2節「兄弟姉妹・暗号出力・リセット」、上記転入101行 | コピーした暗号文を実復号し種別を検査する。 |
| E-05-04 | 第2節「URL共有と利用者取消」、第9節アプリURL非漏洩 | `mode=transfer` を確認する。OS共有先の実配送は未検証である。 |
| E-05-05 | 第2節「兄弟姉妹・暗号出力・リセット」・[headless-workflows:255](../tests/system/headless-workflows.test.js#L255) | 確認付きリセットと保存済み入力の消去を検査する。 |
| E-06-01 | 第3節PoLP/切出/地区設定保護 | 旗振り設定除外と対象地区限定に加え、第11節で正当な文字列 `savedFilePassword` の代表状態/保存/実復号出力への非伝搬を直接補完した。 |
| E-06-02 | 第3節自治会・転入の各統合行 | 不一致/重複/割当取消と既存名簿の不変を確認する。 |
| E-06-03 | 第3節一般ファイル転入振分と貼付復元、[security-render-coverage:84](../tests/unit/security-render-coverage.test.js#L84) `security representative: the master-restoration picker routes transfer data and cancels without changing existing records` | 代表マスター用pickerから転入と判定して専用処理へ渡すことを検査する。 |
| E-06-04 | 第9節SEC-18単体/UI | 先行Redで旧name/kana/余剰個人情報の残留を検知した。是正後対象限定Greenは全回帰合格と区別する。 |
| E-08-01 | 第5節パスワード・[headless-workflows:214](../tests/system/headless-workflows.test.js#L214) `UI passwords: ${mode} full-width sanitation, 11/12 chars, mismatch, visibility` | 各モードの11/12文字、全角、確認不一致、可視化を実DOMで検査する。 |
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
| R-08・R-17 / E-02-07 / I-05 | [headless-specification-contracts.test.js:59](../tests/system/headless-specification-contracts.test.js#L59) `UI specification flag settings: ${width}px member format controls and four metadata groups follow their responsive layout` | 375pxでは当番名簿内の書式行のcomputed flex-direction=column、format/同一世帯まとめの存在と順番、旧プレビュー・コピー操作の不在、正の矩形寸法・縦の非重複・左辺揃いを検査する。768/1280pxでは休日/特別枠/header/footerの4枠と各入力の対応、computed2列、上段/下段の行と列座標、非重複を検査する計3件である。 |
| R-02・R-03・R-04・R-17 / E-02-08・E-03-01・E-04-04 / I-05 | [headless-specification-contracts.test.js:102](../tests/system/headless-specification-contracts.test.js#L102) `UI specification saving cards: district, representative and neighbor have four ordered sections inside the final workflow card` | 実モード切替/カード展開後、各保存カードがtab直下の最後のcard、全4sectionが同一card-body直下に正しい順序で存在、IDは文書内で一意、区分ごとの実password/import/export/year controlの包含、表示矩形の正の寸法と上下非重複を3モードすべてで検査する1件である。 |
| R-07・R-13・R-15 / E-06-01・E-08-05 / I-03・I-04 | [specification-contracts.test.js:160](../tests/unit/specification-contracts.test.js#L160) `specification aggregation privacy: an imported remembered district password never reaches representative storage or decrypted master and split handoffs` | 正当な記憶パスワードと名簿を実暗号化して一般ファイル取込へ通し、名簿受理を確認したうえで代表状態・LocalStorage・実復号マスター・実復号切出からプロパティと秘密canaryを除外する。元地区オブジェクトと秘密は保持し、切出明示鍵は代表入力鍵より優先し、代表入力鍵では切出が復号できないことも確認する。 |

## 12. 最終全回帰と品質ゲート

今回の最終実測は `npm test` 709/709、`npm run test:ui` 111/111であり、いずれも失敗・取消・スキップ0件である。追加した保存パスワード非混入の1件を含む。12本番モジュールはすべてLine 100%、Branch 95.27〜100%、Funcs 98.55〜100%であり、要求閾値を満たす。実行環境と全モジュールの値は[検証記録](reviews/review59_specifications_verification.md)、独立判定は[テストGate 2](reviews/review58_specification_tests.md)と[最終Gate 3](reviews/review60_specifications_security_final.md)に記録する。

本表で今回特定したアサーション不足は第8・9・11節の追加テストで補完した。公開配信・実認証器・OS印刷/共有先の境界は、これらの数値をもって検証済みとはしない。

## 12. ハタフロット全機能統合とiOS導線（2026年11月10日）

| 要件・仕様 | 実アサーション | 環境・境界 |
| --- | --- | --- |
| R-08 / E-02-10 / I-04-08 | `hata-complete.test.js` の上流JSON読込は全キー・空文字・空曜日・false・不正dedup型を確認する。LINE本文は通常/休日/特別枠と連絡文を確認する。 | Node、DOMモックである。 |
| R-08・R-11 / E-02-10 | `headless-hata-complete.test.js` の375/1280px試験は手編集・重複警告・反映取消・曜日・複数行時間・最新設定の印刷・全hata値の暗号化ファイル出力/実読込・再起動復元を確認する。 | 実Chromium、file起動、実WebCrypto。印刷ダイアログと保存先の完了は代替する。 |
| R-08・R-15 / E-02-10 | `headless-import-leakage.test.js` は外部名簿を保持しつつ児童名簿が変わらないこと、悪意文字列のDOM非生成・イベント非実行・通信非発生を確認する。 | CDPの観測であり、HTTP本番配信を証明しない。 |
| R-08 / I-04-08 | `hata-complete.test.js` は暗号化処理中に編集が入った場合に古い保存スナップショットで未保存警告を消さないことを確認する。 | Node、状態と表示の検証である。 |
| R-16 / E-01-08 / I-06-08 | `pwa-install.test.js` はHTTPS/通常HTTP/fileとiOS/Mac型iPad/standaloneのボタン条件、保留プロンプト消費、appinstalled、PNG実体を確認する。 | navigator/locationはモックである。 |
| R-16 / E-01-08 | `headless-hata-complete.test.js` はiPhone/iPad型UA・standalone・desktopの認識、metaタグ、native dialogの表示/閉じる/Escapeを確認する。 | Chromium上のUA再現である。fileではボタン非表示を確認し、案内開閉は直接関数を呼ぶ。iPhone実機のSafariで共有→ホーム画面追加→独立起動は未検証である。 |

比較元の機能一覧・コミットは [統合設計記録](reviews/review61_hata_integration_design.md) に示す。将来の上流変更の追従を保証するものではない。

## 13. LINE内ブラウザとJSON読込専用化（追加要件）

| 要件・仕様 | 実アサーション | 環境・境界 |
| --- | --- | --- |
| R-08 / E-02-10 | `hata-complete.test.js` と `headless-hata-complete.test.js` はJSON出力API/ボタンの廃止と読込維持、地区暗号化ファイルによる全設定保存を確認する。 | Nodeと実Chromiumである。 |
| R-17 / E-01-09 / I-06-09 | `browser-handoff.test.js` はLINE/通常UAと、元URLの機微なquery/hashを除外した外部ブラウザURLを確認する。 | UA・locationはモックである。 |
| R-12・R-15・R-17 | 同単体試験は未完了転入者・全設定・代表下書きの型/旧行index検証、誤鍵、不正型、全モデル保存失敗のrollback、暗号化維持とロック拒否を確認する。 | Node、実WebCrypto、ストレージ/API制御を含む。 |
| R-14・R-17 | `headless-browser-handoff.test.js` はLINE警告、暗号化ファイル/貼付復元、独立保存領域相当の消去後の復元と再起動、未確定名簿の取消、誤鍵・置換取消、Escape・ロック後の遅い暗号化の無効化を確認する。 | 実Chromiumのfile起動である。LINE/Safari実機間の切替とOSファイル配送は未検証である。 |

## 14. UI監査・当番名簿整理・安全な下書き（2.9.1）

| 要件・仕様 | 実アサーションと環境 | 未検証境界 |
| --- | --- | --- |
| R-08 / E-02-11 / I-04-09 | `headless-ui-audit.test.js` は書式変更による手編集保護、取消/明示反映、全半角住所の兄弟重複排除/解除、未完成の期間/休日/特別枠の暗号化地区出力・引き継ぎ・再起動・修正、古いシフトの出力禁止を実UIで検査する。`hata-input-drafts.test.js` は許可キー/型と有効設定の保全をNodeで検査する。 | 実OSのクリップボード・印刷・ファイル配送は代替を含む。 |
| R-17 / E-01-09 | `headless-ui-audit.test.js` は暗号化先4モデルと再起動、提出パスワード除外、平文/暗号化保存失敗の原子性、ファイル優先/容量超過/選択解除/再試行、不正な認証済みデータ、閉じる/ロック/再開/遅延/二重操作、地区追加Enter・代表下書き保存後の座席保持を検査する。 | LINEから通常ブラウザへのOS移動は未検証である。 |
| R-11〜R-17 / E-01-03・E-01-09 | 同UI試験は375/768/1280pxのdialog矩形/スクロール/Tab/Escape/フォーカス復帰と、悪意ある引き継ぎ文字列のDOM不生成、イベント不実行、CDP通信監視の陽性対照と秘密文字列の通信不在を検査する。 | iPhone Safariでのホーム画面追加と安全な実HTTPS配信は別途実機確認が必要である。 |
| R-08 | 同UI試験は土日指定・休日・特別枠・免除・JSON手動調整・集計・モバイル表示、暗号化出力中の追加編集による未保存警告保持を検査する。 | 日付交換関数の直接操作UIは存在しない。単体検証をクリック網羅と数えない。 |

開始時の照合、失敗分類、最終測定値は [review65](reviews/review65_ui_coverage_audit.md) に記録する。

## 15. 保存データ・UI再監査（2.9.2、SEC-20・SEC-21）

| 要件・境界 | 追加した実アサーション | 実装・環境 |
| --- | --- | --- |
| R-08・R-11 / SEC-20 | `security-hata-output.test.js` は入力値内のトークンを再解釈しないこと、10000/10001行、4096/4097文字、UTF-8の1MiBちょうど/1バイト超過、空行の分割上限、日付への反復表示、班/座席選択肢の積を確認する。 | `validateHataTextBudget`、`validateHataScheduleOutput`、`validateDistrictRenderBudget`、`validateRepRenderBudget`、単一パス書式置換。Nodeである。 |
| R-08・R-11・R-15・R-17 / SEC-20 | `headless-saved-data-audit.test.js` は暗号化ファイル/貼付・公式JSONの過大入力拒否、同名ファイル再試行、平文/実暗号化保存の受入拒否、過大な手入力の下書き・実再起動・修正、通常名簿/座席の増幅拒否を確認する。 | 実Chromium、実WebCrypto、CDP入力である。 |
| R-11・R-15・R-17 | 同UI試験は悪意ある書式・免除属性・下書きを暗号化ファイル→引き継ぎ→暗号化保存→実再起動/解除→修正/反映→生成/印刷へ通し、完全な文字列の保持、攻撃DOM非生成、イベント不実行、CDP通信監視の陽性対照と秘密値非送信を確認する。 | ファイル選択はDataTransfer、印刷とOS共有先は代替を含む。 |
| R-12・R-14 / SEC-21 | `security-import-commit.test.js` は平文/実暗号化先で取込中の旧自動保存の無効化、失敗時の旧保存値/世代保持、保存待機中/暗号化中のロック、保存結果の採用直前の世代失効、復号後に全消去した委譲取込の拒否を確認する。 | `commitImportedModel` と `adoptImportedModel`、共通のWeb Locks、世代照合。Node、実WebCrypto、競合制御を含む。 |
| R-03〜R-06・R-08・R-12 / SEC-21 | 同UI試験は地区/代表/自治会/公式JSON/地区への自治会統合/代表への地区・自治会統合/地区・代表への転入統合の9経路について、平文と暗号化先それぞれで実保存APIの失敗、旧4モデル・全保存値の保持、保存失敗通知、同名ファイルの正常再試行を確認する。保存完了後の継続を止め、実ロックしても旧個人情報が画面へ戻らないことも確認する。 | 実Chromium、実保存Promise、Storage APIの容量例外を制御する。 |

既存の4モードCRUD・年度更新・座席同定・全12帳票・PWA案内・認証/ロック・CSP/改ざん/予約キーのアサーションも全体/UI一式で再実行する。詳細な再現、試験側の待機/モデル参照の是正、最終測定値と未検証境界は [review66](reviews/review66_saved_data_security_audit.md) に記録する。

## 家庭情報入力の改修（2026年11月11日）

R-05 / E-05 / I-03・I-04 の追加観点は `tests/unit/household-transfer.test.js` と `tests/system/headless-household.test.js` に対応する。家庭欄の型・必須検査、旧下書き移行、兄弟追加、復元・消去、暗号文の復号内容、固定ファイル名、地区・代表への住所・電話番号の保持、共有ボタン集約、パスワード案内を検査する。実行結果および未実施工程は [review67](reviews/review67_household_information_verification.md) へ記載する。実機のLINE配送・本番更新は検証対象外である。

## 2026-11-17 改修の検証計画

| 要件・仕様 | 実装対象 | 具体的アサーション・環境 |
| --- | --- | --- |
| R-08 / E-10-03 | CSS、hata.js | Chromium 375/390/1280px、0/1/多人数、開閉、末尾まで実スクロール、通常・特別回数・免除・手動変更・再生成 |
| R-12 / E-10-01〜02 / I-08 | app.js、crypto.js、events.js | 実WebCrypto設定・再起動・誤鍵・モード変更、役員フォーム非表示・操作拒否、暗号文不変、旧平文移行 |
| R-19 / E-10-04 | app.js | 無応答fetch、応答本文無応答、オフライン、手動確認復帰、初期化と入力継続 |
| R-19 / E-10-05 | CSS、events.js | Chromiumのフォーム内選択許可、フォーム外copy/cut拒否、明示コピー維持 |

独立サブエージェントレビューは本セッションの実行制約により未実施である。実装担当の点検を独立Gate PASSとして扱わない。OS画面取得・クリップボード履歴・実HTTPS/PWA更新はローカル試験の保証外である。

## 今回の追加セキュリティ追跡

| 仕様・指摘 | 具体的検査 | 証拠 |
| --- | --- | --- |
| I-09 / SEC-22 | 実WebCrypto待機→設定/解除画面から移動→新規入力→旧処理完了、鍵/保存/入力保持。生体認証と採用直前中断も単体検査する。 | `headless-security-followup.test.js`、`security-output-lifecycle.test.js` |
| I-09 / SEC-23 | 全8出力で暗号化中ロックを挟み、download/clipboardがないことを確認する。失敗後の手動コピー/ダウンロード/外部起動も阻止する。 | 同上、[追加評価](reviews/review69_followup_security_assessment.md) |
| I-09 / SEC-24 | 暗号化中の地区名・班編集後に実復号し、本文・見出し・ファイル名が同じ取得時点であることを確認する。 | `security-output-lifecycle.test.js` |
| E-10-04 | fetchと本文の無応答を5秒でabortし、手動ボタン復帰と遅い応答の無効果を検査する。 | `access-version.test.js`、`headless-access-mobile.test.js` |
| I-08 / SW | mode URLは固定index.htmlへ対応し、通常scriptのcredentials includeを匿名化する。未知URL/更新URL/認証ヘッダーは保存しない。 | `sw-security.test.js`。実HTTPは `tests/manual/offline-http.js` に残し未完了を明記する。 |

最終測定と制約は[今回の検証記録](reviews/review70_mobile_encryption_security_verification.md)を参照する。旧記録の平文任意仕様と件数を今回の結果へ流用しない。

## 2.11.1 追加セキュリティアセスメント追跡（SEC-25 〜 SEC-29）

| 要件・仕様・指摘 | 具体的検査観点 | 対象テスト・記録 |
| :--- | :--- | :--- |
| R-20 / E-10-06 / I-10 / SEC-25 | 未暗号化端末の家庭情報入力・自治会モードからの引き継ぎ作成（役員モデル・役員下書き除外）とアプリ更新成功、未暗号化先での役員引き継ぎ（`district`/`rep`/`repDraft`/役員下書き）の `STORAGE_ENCRYPTION_REQUIRED` 拒否とゲスト専用引き継ぎ復元（平文役員キー非書込み）。 | `browser-handoff.test.js`、`security-state.test.js`、`headless-security-followup.test.js` |
| R-20 / E-10-07 / I-10 / SEC-26 | ロック中ワンクリック設定の解除モーダル遷移、新規設定時（`!isStorageEncrypted()`）および解除済み時の双方での `neighbor-pass`/`rep-pass` 非汚染（地区側保存・完了通知抑止含む）、非同期暗号設定・生体認証登録のキャンセル/ロック後無効化、`prfResult` バッファゼロ化、`meta.webauthn` 非null時の型・必須キー検証。 | `security-output-lifecycle.test.js`、`security-crypto.test.js` |
| R-20 / E-10-08 / I-10 / SEC-27 | ロック後のクリップボード書込成功・拒否後通知/フォールバック抑止、代表切り出し確認パスワード不一致・>2000文字退避、ロック後復号失敗時の再入力プロンプト/再描画/アラート抑止、個別PDF複数印刷中のロック後後続印刷中止と `#print-area` 消去。 | `security-output-lifecycle.test.js`、`headless-security-followup.test.js` |
| R-20 / E-10-09 / I-10 / SEC-28 | ロック・年度更新・リセット・引き継ぎ復元での `type="text"` → `type="password"`、`🙈` → `👁️`、判定メッセージ・`#hata-line-text`・`#print-area` の完全消去。 | `security-output-lifecycle.test.js`、`security-state.test.js`、`headless-security-followup.test.js` |
| R-20 / E-10-10 / I-10 / SEC-29 | 旗振りメタ/免除/調整・座席・転入メモの4096文字超過拒否と `maxlength="4096"`、代表モーダル保存の `validateImportData('rep')` 検査、暗号化時データ欠損・他タブ個別キー削除検知、`isNewerVersion` 厳格化・`credentials: 'omit'`、SW `message` 送信元検証。 | `utils.test.js`、`security-state.test.js`、`security-crypto.test.js`、`sw-security.test.js`、`headless-security-followup.test.js` |

詳細アセスメントは [review71](reviews/review71_security_assessment.md)、実装・試験の最終検証記録は [review74](reviews/review74_security_verification.md)、独立ゲートレビューは [review72](reviews/review72_security_design_gate1.md)（Gate 1）・[review73](reviews/review73_security_tests_gate2.md)（Gate 2）・[review75](reviews/review75_security_final_gate3.md)（Gate 3）を参照する。


## 8. 次年度名簿作成と長文保存の再検証（2.12.0）

| 要件・仕様 | 実装 | 具体的な検査と実行環境 |
| --- | --- | --- |
| R-21 / E-11 / I-11 長文入力・旧保存復旧 | `utils.js`, `state.js`, `events.js`, `hata.js`, `index.html` | `hata-text-recovery.test.js` と `headless-next-year.test.js`：4096/4097文字、有効値保持、全文下書き、実WebCrypto保存・解除・修正・再解除、DOM文字数上限と出力停止。 |
| R-21 / E-11 / I-11 共有拒否 | `rep.js` | `hata-text-recovery.test.js` と `security-output-lifecycle.test.js`：長文LINE/mailのコピー拒否・API不在で外部起動ゼロ、失敗通知、ロック後通知抑止。OSの実共有は未検証である。 |
| R-22 / E-11 / I-11 児童限定追加 | `crypto.js`, `district.js`, `events.js`, `index.html` | `next-year-import.test.js` と `headless-next-year.test.js`：役員ファイル通常読込→児童限定追記→暗号化出力・復元、役員等保持、無進級、重複・地区相違の確認、取消・不正・保存失敗・ロック時の原状維持。 |

実施結果と独立レビューの有無は検証記録へ分離して記載する。上記はテスト設計であり、未実行の合格を示さない。

実施した最終結果・未検証境界・独立レビューの有無は [review77](reviews/review77_followup_verification.md) を参照する。

## 16. 保存値の復元可能性・取込信頼範囲（2.12.1、SEC-30 〜 SEC-35、QA-01 〜 QA-11）

| 要件・仕様・指摘 | 具体的な検査（正常系・境界値・異常系） | 対象テスト |
| :--- | :--- | :--- |
| R-23 / E-12-01 / I-12-01 / SEC-30 | 児童・地区役員・自治会役員・外部関係者・代表地区の追加、班リスト、代表への地区追加で、上限内は確定・上限超過は通知し、モデル・入力欄・保存値が変更前のまま。 | `security-save-invariant.test.js` |
| R-23 / E-12-02 / I-12-02 / SEC-30 | 不合格値は保存せず `false`・原本不変・警告表示の継続・新規キーだけ通知・離脱確認・成功で表示解除。ロック中・平文拒否の保存では通知も集合登録もない。拒否中のアプリ更新・引き継ぎ作成は区別した文言で中止。不合格のメモリ値があるときの端末暗号化設定は鍵生成・`registerWebAuthnPrf` を呼ばず何も書かずに中止し、合格後の鍵導出中にメモリを変更しても検証時点の内容が書き込まれる。拒否後に修正して保存すると再解除できる。拒否中のキーを取込・引き継ぎ復元で書き込むと警告と離脱確認が消える。 | `security-save-invariant.test.js`、`headless-save-invariant.test.js` |
| R-23 / E-12-03 / I-12-03・04 / SEC-30 | 6段目割当て→5段へ縮小の確認・取消（無通知・段数とセル保持）・承認（範囲外削除）、範囲外が空席だけなら確認なしで削除、2/10/14の境界、拡大時の描画予算超過で元に戻る。4096文字の地区名で `refKey` 4102文字を保存・実解除、`refKey` 4160文字受理・4161文字拒否。姓・名各4096文字の `name`（8193文字）、住所4096＋苗字4096の免除キー（8193文字）を保存・実解除、8194文字は拒否。 | `security-save-invariant.test.js`、`headless-save-invariant.test.js`（実Chromium・実WebCrypto・実再起動） |
| R-23 / E-12-04 / I-12-05 / SEC-30・SEC-31・QA-06 | 2.12.0 で保存された範囲外セル・座席表示量超過・旗振り展開量超過・長い旧別名キーを持つ暗号化端末の解除が成功し、修復結果を表示し、原本は次の保存まで不変。修復で解決しない不正値は従来どおり拒否。ファイル取込は厳格なまま。旧別名は正式キー `undefined` 時だけ下書き化、作成日は `metaCreatedDate` 優先。 | `security-save-invariant.test.js`、`import-output-hardening.test.js` |
| R-23 / E-12-05 / I-12-07・08 / SEC-30 | 検証失敗の解除でパスワード・生体認証とも検証失敗の文言、誤パスワード・認証失敗は従来文言。平文起動で不正保存値なら既定状態で起動し、以後の自動保存で原本を上書きせず、全消去で停止解除。 | `security-save-invariant.test.js` |
| R-23 / E-12-06 / I-12-09 / SEC-31 | 予算境界の設定で「通年」を押しても有効期間を変えず下書きへ保持し再解除できる。上限内は採用して下書きを消す。基準年の検査は第17節（E-13-03）による。 | `security-save-invariant.test.js`、`hata.test.js` |
| R-23 / E-12-07 / I-12-15 / QA-11 | 名簿未設定の自動生成が上限超過なら通知・プレビュー更新し、`members`・`inputDrafts` を変更しない。上限内は生成・採用。 | `security-save-invariant.test.js` |
| R-23 / E-12-08 / I-12-11 / SEC-33 | ファイル・貼付内の記憶パスワードを不採用（`#d-pass`・同意・保存値不変）、既存の記憶パスワードを維持、保存・共有の復号内容に記憶パスワードなし。実Chromiumで取込→保存→実再起動→出力の復号内容。 | `import-output-hardening.test.js`、`headless-save-invariant.test.js` |
| R-23 / E-12-09 / I-12-06 / SEC-34 | 暗号化・解除中に他タブ相当の有効暗号文更新でロック・理由表示（役員モードは解除画面、ゲストは上部案内）、自タブ保存なし。未暗号化・ロック中・同値・他キーは無反応。保存待機中の割込み（排他待ち中に既知値と異なる暗号文）でも上書きせずロック。解除処理中の競合でも理由を表示。実2コンテキスト（iframe）で他タブ更新後に自タブの旧値が復活しない。 | `security-save-invariant.test.js`、`headless-save-invariant.test.js` |
| R-23 / E-12-10 / I-12-10 / SEC-32 | 8MiB 近い病的入力（空白、`BEGIN_DATA:` 反復）を時間上限内に拒否。前後の見出し・空白・`:END_DATA` 欠落・接頭辞なし・複数区画の抽出結果。 | `import-output-hardening.test.js` |
| R-23 / E-12-11 / I-12-12 / QA-01 | 暗号化・役員データありの端末へゲスト引き継ぎを復元しても地区・代表は保持、自治会・家庭情報だけ置換、確認文。役員モデル入りは全置換。モード・役員下書きだけ非空でモデルが空の場合は確認文・置換とも保持側。取消は不変。実Chromiumで復元→実再起動。 | `handoff-guest-preserve.test.js`、`headless-save-invariant.test.js` |
| R-23 / E-12-12 / I-12-12 / SEC-35 | 地区追加名4096文字受理・4097文字拒否、引き継ぎ下書き4097文字を確認前に拒否。実Chromiumで引き継ぎ→地区追加。 | `handoff-guest-preserve.test.js`、`security-save-invariant.test.js`、`headless-save-invariant.test.js` |
| R-23 / E-12-13 / I-12-13 / QA-03 | 学年 `'1'`/`'6'` 受理、空の仮行（学年 `''` 含む）は除外して読込成功、実在行の `''`・`'0'`・`'7'`・`'６'`・`'1年'` は氏名を示して拒否し状態不変（地区読込・貼付・児童追加・代表読込）。自アプリが出力した仮行入りの地区ファイル・代表マスターを再取込できる。家庭情報の学年 `'7'` を拒否、版1の空欄は1年。端末保存値は従来受入。 | `import-output-hardening.test.js` |
| R-23 / E-12-14 / I-12-13 / QA-02 | 再起動後の仮行を除いて追記、入力済み行・学区外行は保持。追加件数・成功・失敗通知の文言。 | `import-output-hardening.test.js` |
| R-23 / E-12-15 / I-12-14 / QA-04・QA-08 | 地区の長文LINE・メールでコピー拒否・API不在なら外部起動0回・失敗通知、成功時は案内文のみ起動、ロック後は無通知。代表切出しコピーのAPI不在通知。実Chromiumで拒否→再試行。 | `import-output-hardening.test.js`、`headless-save-invariant.test.js` |
| R-23 / E-12-16 / I-12-15 / QA-05 | `TZ=Asia/Tokyo` で日本時間0:30相当の `Date` が前日にならない、年末境界、月日0埋め、出力ファイル名と見出し。UTC日付による生成の不在。 | `import-output-hardening.test.js` |
| R-23 / E-12-17 / I-12-15 / QA-07 | 休日・特別枠注記のカンマ保持、注記の既定値、再結合した注記長での上限検査が生成と一致する。 | `import-output-hardening.test.js` |
| R-23 / I-12-02・05 / SEC-30 | 構造操作・保存前検証は修復なしの厳格検証であり、座席拡大による描画予算超過・範囲外セル・旗振り予算超過は修復付きなら通る値でも拒否される。拒否通知は排他区間の外で行い、通知中も他の保存が進む。 | `security-save-invariant.test.js` |
| R-23 / I-12-03 / SEC-30 | `lastName: ''`・`firstName: ''` で8193文字の `name`、`lastName` 未定義・`firstName` 非空・空白なし8193文字の `name`（`childName` も同様）は拒否し、`lastName` なし・空白なし8193文字の `name` も拒否し、4096文字の `name` は正規化後に保存・再解除できる。`childName` も同様。`lastName` ありの8193文字 `name` は保存・再解除できる。 | `security-save-invariant.test.js` |
| R-23 / E-12-04 / I-12-05 / SEC-30 | 配列形式の `holidays`・`members` を持つ旗振りの予算超過を文字列化して下書きへ修復できる。修復時は内容を1回通知し、修復なしでは通知しない。 | `security-save-invariant.test.js` |
| R-23 / E-12-05 / I-12-07 / SEC-30 | 平文起動で不正な1キーだけ停止し他キーは通常読込・保存。停止中の端末暗号化設定は拒否して原本不変。停止中もアプリ更新は止まらず、引き継ぎ作成は停止中の文言で中止する。全体置換の自治会読込・引き継ぎ復元で当該キーを書くと停止解除、部分合成の取込は停止中キーへ書かない。全消去で停止解除。修復通知は描画・セッション確認後だけ。 | `security-save-invariant.test.js` |
| R-23 / E-12-09 / I-12-06 / SEC-34 | 取込の保存直前に他タブ更新がある場合、`IMPORT_SAVE_FAILED` の文言を出さずロック・理由表示し、他タブの値を保持。引き継ぎ復元も同じで、引き継ぎ画面に「引き継ぎに失敗しました」を表示しない。 | `security-save-invariant.test.js` |
| R-23 / E-12-13 / I-12-13 / QA-03 | 家庭情報の学年違反は、地区・代表の家庭情報読込（ファイル・貼付）でパスワード再入力を求めず該当児童を示す。 | `import-output-hardening.test.js` |
| R-18 / I-07 / QA-09・QA-10 | 死にコードの不在、グローバル差替えの復元、弱い assertion の強化、条件待ち化、分岐網羅の余裕確保（平文起動時の予期しない例外、保存時の一般例外、地区追加ダイアログの長さ超過、セル未定義の座席変更、判定関数の境界）。 | 各既存テスト、`save-invariant-coverage.test.js` |

実行結果・独立レビューの判定は [review78](reviews/review78_test_security_assessment.md) 以降の記録に分離して記載する。上記はテスト設計であり、未実行の合格を示さない。最終の実行結果・カバレッジ・未検証境界は [review82](reviews/review82_verification.md)、独立ゲートは [Gate 1](reviews/review79_design_gate1.md)・[Gate 2](reviews/review80_tests_gate2.md)・[Gate 3](reviews/review81_final_gate3.md) を参照する。

## 17. 出席初期チェックと期間プリセットの基準年（2.12.1、R-24、SPEC-Q1・Q2・Q4）

旧仕様（部分一致・暦年基準・空名簿への取込で旧キーを合成）を前提にした既存の assertion は、次のとおり新仕様へ書き換える: `rep.test.js` の初期チェック試験（副会長を部分一致でチェックする期待値を、会長だけ・会長なしは氏名のある最初の行へ）、`branch-coverage.test.js` の「重複地区」への自治会取込（旧キー `{1:true}` を合成する期待値を、E-13-01 で作り直した `{0:true}` へ）、`security-save-invariant.test.js` の期間プリセット試験（暦年の期待値を年度へ）。

| 要件・仕様・指摘 | 具体的な検査（正常系・境界値・異常系） | 対象テスト |
| :--- | :--- | :--- |
| R-24 / E-13-01 / I-13-01 / SPEC-Q1 | 「会長」「自治会長」「町内会長」「町会長」、前後に半角・全角空白のある「会長」は会長。「副会長」「会長代行」「PTA会長」「副自治会長」「区長」「会長・副会長」、空文字、`null`・数値・配列の役職、`null` 行は会長でない。氏名のある会長が複数なら全員、氏名のない会長は対象外で氏名のある最初の行、氏名のある行がなければ `{}`（年度更新後の会長・副会長の空枠を含む）、空名簿・非配列は `{}`、同じ内容の重複行は会長でも出席にせず代替は一意な最初の氏名行、氏名のある会長が重複行だけなら代替なしで `{}`（他の一意な氏名行があっても）。新規地区の集約・自治会ファイル取込の初期チェックが副会長を含まない。空枠だけの旧名簿への取込は新しい名簿として扱い、会長がいなければ氏名のある最初の行をチェックする。実Chromiumで自地区データの合算（会長・副会長・氏名のない会長枠）後、出席セレクタは氏名のある会長だけがチェック済みで、座席候補に氏名のない自治会役員が出ない。 | `chairman-fiscal-year.test.js`、`rep.test.js`、`headless-save-invariant.test.js` |
| R-24 / E-13-02 / I-13-02 / SPEC-Q2 | 自治会ファイル・地区ファイル・マスター読込欄・貼付読込・自地区の合算で名簿を差し替えると新会長が出席、同一本人の出席有無（外したチェック、キーなし）は引き継ぐ、本人一致の会長を外していれば戻さない、本人一致でキーのない会長はチェックなしのまま、会長なしの差替えで代替チェックなし、氏名のない行は旧版の `true` があってもチェックなし、差替え後の名簿で重複する行は会長でもチェックなし、差替え前の名簿で重複していた本人の会長はチェックする。他の地区の出席は変わらない（重複会長行の `false`・`true`、`szNeighborChecks` のないエントリ）。置き換えない同名・別班のエントリは E-13-02 の作り直しの結果となる（代表名簿・取込後の名簿と一意に一致する本人だけがその出席を持ち、代表と名簿が異なるエントリで外したチェックの会長は一致しなければキーなしで、チェックなしのまま）。置き換えるエントリに `szNeighborChecks`・`neighborhood` がなくても取込が成功する。自治会ファイルを先に取り込んだ仮エントリを班付きの地区ファイルが置き換える場合も、仮エントリの外したチェック・キーなしを引き継ぐ。名簿のない地区ファイルで仮エントリを置き換える場合は自エントリの写しとして、出席（重複行・空欄の枠の値を含む）と印刷対象の選択を変えず、同名の他エントリを作り直さない。名簿のない地区ファイルの再取込は、自エントリの名簿を写す場合は出席不変（外した重複会長行を含む）、別エントリの名簿を写す場合は代表名簿（氏名のある行がなければ写し元）の出席を本人単位で引き継ぎ会長の自動チェックなし（写し元が代表でない場合を含む）。旧形式の `name` だけの行の名簿と、役職がなく新形式の氏名だけの行の名簿は、地区ファイルでも自治会ファイルと同じく名簿として扱う（新しい地区では氏名のある最初の行が出席、同名の既存名簿で上書きしない、写し元の判定でも名簿）。氏名・役職が空白だけの行の名簿は名簿として扱わない（名簿のない取込として既存の名簿を写し、写し元にもならない）。照合の手間は行数に比例する: 照合の本体（`resolveImportedNeighborChecks`・`alignNeighborChecksToGroup`・`reconcileSeatState`）を、比較元と一致しない行（照合で走査が必要になる行）の受入上限の1万行とその16分の1の行数で直接測り、CPU 時間の比が48未満（線形で約10〜21、2乗の照合は全体を `indexOf` で走査する形・位置だけを探す形・`clearDuplicatesOf` を数える形で約110〜260）。取込の経路全体（自治会ファイル、別班の作り直しを含む地区ファイル）も1万行で CPU 時間3秒以内。CPU の3倍の負荷の下でも誤って失敗しない（8回とも合格）。名だけ（`firstName`）の行の名簿も名簿として扱う。空の行に役職か氏名のある行が1行でも混じれば名簿（取り込む名簿・写し元とも）、ふりがな・電話・住所だけの行は名簿に数えない（名簿のない取込の写し元でも、そうした行だけの同名エントリを飛ばす）、写し元は地区名の完全一致で選ぶ（前後の空白だけが異なる地区名のエントリは写し元にしない）。自治会ファイルは、空白だけの行の名簿や空の名簿でも同名の全エントリの名簿を置き換え、出席をなしにする。役職だけの行（年度更新後の空枠）の名簿は写し元の判定で名簿として扱う。取込の名簿の判定（空白を除く）と、代表名簿・座席候補の行数の数え方（従来どおり空白だけの値も数える）は異なる。取込以外の経路の出席の再照合は、代表名簿とそのエントリの名簿の両方で一意な本人にだけ引き継ぐ（旧版と同じ。印刷対象から外した代表名簿のエントリ自身と、印刷対象外の代表でない同名エントリも同じ規則で再照合する）。写す名簿もない場合は、置き換えるエントリの出席はなし（残っていた値も消える。同名エントリがなければ新しいエントリも `{}`）で、同名の他のエントリは変わらない。座席: 取込（地区ファイル・自治会ファイル・貼付読込・自地区の合算）で、座席を割り当てた会長が電話・住所だけの異なる同じ氏名・役職の会長に差し替わると、新しい会長は出席になるが旧会長の座席は解除される。同じ本人の座席は行が移っても追随し、旧会長が新しい会長と並んで残る場合は旧会長の行へ移る。氏名・役職が同じで電話の異なる2人の座席は、取込ではそれぞれの本人に付いたまま新しい行へ移り、印刷対象の切替では2人がともに出席していても座席が残る（旧版は解除）。取込で新たに出席になった会長の座席は、その後の印刷対象の切替で、電話の異なる同名の会長がいるエントリへ座席候補が替わっても、その会長へ移らない。取込を経ずに電話の異なる同名の会長がいる地区でも、地区の削除（`deleteRepDistrict`）で座席候補のエントリが替わると、座席はその会長へ移らない。自由入力・設備の座席は、取込（地区ファイル・自治会ファイル）・印刷対象の切替（一括を含む）・地区の削除・地区詳細モーダルの保存（座席候補が替わる場合を含む）のいずれでも変わらない。実Chromium では、取込が保存した状態のまま（再起動の前に保存し直さずに）実再起動し、解除された座席が保存されていることと、座席表の印刷に別の山田が出ないことを確かめる。地区名の前後の空白だけが異なるエントリが取込で座席候補になると、同じ本人でも座席は解除される（旧版と同じ）。解除される座席: 変更前の座席候補のエントリで重複していた行（自エントリの名簿を写す名簿のない取込で出席が変わらない場合を含む）、変更後の座席候補のエントリで重複したままの行（取り込んでいない地区を含む）、取込で出席でなくなった本人（別班の作り直しを含む）、座席候補のエントリの地区名が前後の空白だけ変わった場合、別班の作り直しで出席になった電話の異なる同名の会長への引継ぎ、変更前に同じ識別子の候補が2人いた座席。引き継がれる座席: 代表名簿が印刷対象外で座席候補のエントリと異なり、代表名簿で重複する本人や代表名簿にいない本人でも、座席候補のエントリで一意な同じ本人が出席している場合（地区名の前後の空白だけが異なる座席候補のエントリを含む）、所属と表示名が同じ自治会役員と外部関係者の両方（取込・印刷対象の切替とも。旧版はどちらも解除）、表示名が自治会役員の識別子の文字列と同じ外部関係者。地区詳細モーダル: 座席候補のエントリが替わらない編集は従来どおり対応表で写し、座席のある行を削除すると座席は解除され（削除後に同じ添字へ来る別の本人へ写さない）、写し先の行が名簿内で重複すれば解除される（地区名が代表名簿と前後の空白だけ異なる座席候補のエントリを含む）。座席候補のエントリが替わる編集で、編集後の本人と削除した行の本人が同じ出席者になる場合は、別々の座席が1人に集まらずどちらも解除される。座席候補のエントリが別のエントリに替わる場合は、連絡先を直した行も、氏名・役職を直した行も、編集前と編集後の本人のうち新しい座席候補のエントリに一意に出席している方へ引き継ぐ。出席の代表が印刷対象外の別エントリで、新しい座席候補のエントリに編集前の本人だけが出席していれば編集前の本人へ（連絡先を直した場合）、編集後の本人だけが出席していれば編集後の本人へ（氏名と連絡先を直した場合）引き継ぎ、両方が出席していれば解除される（どちらの場合も）。どちらも出席していなければ、所属と表示名が同じ別の本人（電話の異なる同名の会長）が出席していても解除される。削除した行と、編集後の名簿で重複させた行は編集前の本人で照合し（削除後に同じ添字へ来る行の本人だけが新しい座席候補に出席していれば解除、削除した本人も出席していれば削除した本人へ引き継ぐ）、出席の代表が印刷対象外の別エントリで、その本人が新しい座席候補のエントリに一意に出席していれば引き継ぎ、出席していなければ解除される。印刷対象の切替（一括を含む）と地区の削除では、他の地区の操作なら同じ本人の座席が残り、座席候補のエントリが替われば別班の同じ本人の行へ座席が移る。外部関係者の行を削除しても自治会役員の座席は変わらない（`SPEC-Q2: print selection, district deletion and external deletion keep or move the seat of the same person`）。座席候補が替わるモーダル編集で、座席のある行を削除または別の値に直し、他の座席のある行を同じ本人の内容に直すと、2つの座席は1人に集まらず両方解除される。同じ出席者を複数の座席に割り当てた場合は、取込・印刷対象の切替・地区詳細モーダルの保存の後もそろって引き継がれ、行が移れば全席が新しい行へ移る（同じ出席者の座席どうしは一対一の規則で解除しない）。同じ出席者の2席は、その本人を確かめられない取込（電話の異なる同名の会長への差替え）と印刷対象の切替で2席とも解除され、別の本人へ移らない。同じ出席者の2席と別の出席者の1席が、座席候補が替わるモーダル編集で同じ出席者に当たると3席とも解除される。対応表の写し先と照合の引継ぎ先が同じ候補になる場合は、両方とも解除される。座席候補が替わるモーダル編集で、座席のある行を変えずに他の行だけを削除した場合は同じ本人へ引き継ぎ、座席のある行の添字が編集で移る場合は、編集前後の行の対応で本人を求める（新しい座席候補にその本人がいれば引き継ぎ、いなければ解除）。編集後の名簿で重複する行は、編集後の本人が新しい座席候補に出席していても編集前の本人だけで照合する。座席候補が替わるモーダル編集でも、編集したエントリ以外の候補（外部関係者・別班の校外役員・他地区の自治会役員。編集した地区名に「_」を続けた名前の地区を含む）の座席は変わらない。地区名に前後の空白がある同名エントリの間で座席候補が替わる場合も、新しい座席候補に出席している編集後の本人へ引き継ぐ。座席候補が替わらない編集で座席のある行を重複する内容に直すと（地区名が完全に一致する通常の場合）、写し先は出席でなくなって座席は解除され、後で行を直して出席にしても座席は戻らない。編集したエントリが編集によって初めて座席候補のエントリになる場合は、編集前後の対応を使わず、他のエントリの座席を編集した行の本人へ移さない。一括の印刷対象の切替（`toggleAllDistrictChecks`）でも、座席候補のエントリが地区名の前後の空白だけ異なるエントリへ替わる座席、出席の代表が印刷対象外で電話の異なる同名の会長への座席、地区名が完全に一致する座席候補で重複していた行の座席（旧版は引き継いだ）は解除される。変更の前後とも座席候補ではないエントリ（印刷対象外の代表名簿、行数の少ない印刷対象のエントリ）をモーダルで編集した場合は、編集前後の対応を使わず本人単位の照合だけを行う（座席が同じ添字の別の本人へ移らず、座席候補の本人の座席は残る）。印刷対象の切替でも、所属と表示名が同じ自治会役員と外部関係者の座席はどちらも残る。変更前の座席候補で重複していた行の座席は、座席候補が替わる編集では解除され、替わらない編集では写し先が一意なら写される。所属の文字列（地区名と役職をつないだもの）と氏名が同じで地区名・役職の異なる2人の座席は、印刷対象の切替で両方残る（旧版は両方解除）。校外役員・外部関係者どうしの照合（所属と表示名）は変わらない。`getAllSzParticipantsForSeat` の自治会役員の候補は `identity`（重複行は `null`）を持ち、校外役員・外部関係者の候補は持たない。代表名簿に氏名のある行がない（役職だけの行が最多）場合、地区ファイルは置き換えるエントリ自身の名簿と、自治会ファイルは一覧の順で最初に氏名のある行を持つ同名エントリの名簿と照合し、自治会ファイルの結果は同名の全エントリで同じ。新しい別班は同名の代表名簿と照合して代替なし、名簿が異なる場合も各行の規則どおり。地区名の前後に空白がある既存エントリも同じ地区として扱う。差替え前の名簿の範囲外・旧キー（`{0:false}`・`{7:true}` 等）は残らない。両関数で同じ結果。`resolveImportedNeighborChecks` の候補が非配列・`null` 要素・氏名のない候補のみの場合。ファイル・貼付の取込が検証失敗・保存失敗（`localStorage` 書込例外、失敗の通知）の場合はメモリ・保存値とも不変。合算が検証に失敗した場合は不変。地区詳細モーダルで役職を会長へ変えても、印刷対象切替でも、第4引数なし・`{}` でも自動チェックしない。`neighborChecksResolved: true` のときだけ出席を再照合せず座席の再対応だけを行う。代表名簿で会長を外した後、名簿の異なる同名エントリがある状態で自治会ファイル（同数で先頭エントリが代表になる場合）・地区ファイル（置き換えたエントリが最多になる場合）を取り込んで代表が入れ替わっても、出席セレクタ・印刷・座席候補の本人ごとの出席は利用者の設定のまま。地区ファイルで代表エントリの名簿が縮み、旧版の行番号同期で保存された古いチェックを持つ名簿の異なる同名エントリが代表になる場合も、利用者が外した会長は出席にならない（出席セレクタ・印刷・座席候補）。置き換えない同名エントリのうち代表名簿・取込後の名簿のいずれとも一致しない行は出席なしとなる（外したチェックの `false`、旧版の行番号同期で付いた `true` を含む）。置き換えない同名エントリの氏名のない行は、一意な行・重複行とも、揃える元の代表名簿でチェック済みの氏名のない行と一致する場合も、使える揃える元がない場合も、取込後に出席なしとなる。代表エントリを印刷対象から外した後に、代表名簿の氏名のない会長枠がチェック済みのまま同じ名簿の地区ファイルを再取込しても、出席セレクタ・印刷・座席候補に氏名のない自治会役員が出ない（実Chromiumでは同名の別班がある状態で再起動後も確認）。印刷対象の代表である置き換えない同名エントリで、氏名のない出席者に割り当てた座席は、取込後に解除され、座席表に「（ご出席者 様）」が出ない（作り直しの後に座席を再対応する順序）。出席セレクタの同期: 名簿（行の内容と並び）が同じエントリには、重複行・行のない添字を含めて従来どおり同じ行番号へ同期する（名簿のないエントリどうしを含む。既存の同期試験の fixture は変更しない）。名簿の異なる同名エントリには、操作した本人と同じ内容の行（同じ内容の空欄の枠を含む）だけに同期し、同じ行番号の別の本人・氏名のない枠・内容の異なる空欄の枠は変更しない。代表名簿のエントリを印刷対象から外した後に出席セレクタで操作しても、印刷・座席候補の本人ごとの出席は出席セレクタと同じで、氏名のない自治会役員や別の本人は出ない。名簿の異なるエントリについて、操作した行が名簿内で重複する場合、同期先で重複する場合、操作したエントリに同じ添字の行がない場合（ほかに一意な行がある場合、名簿がない場合を含む）、同期先に名簿がない場合は同期しない。地区名が空の場合は操作したエントリだけ変わる。代替の比較元（代表名簿に氏名のある行がない場合）からは、チェックなし（会長・会長以外とも）と会長の行のチェックを引き継ぎ、会長以外の本人のチェックは引き継がない（名簿のない取込の写し元を含む）。代表名簿が氏名のない枠だけで、代替の比較元（置き換えるエントリ、自治会ファイルで一覧の最初に氏名のある行を持つエントリ、名簿のない取込の写し元）の会長以外の氏名のある行に旧版の行番号同期の `true` が保存されている場合、地区ファイル・自治会ファイル・名簿のない取込（別エントリの写し）の後に、その本人は出席セレクタ・印刷・座席候補で出席にならない（取込後にそのエントリが代表になる場合、印刷対象の代表になる場合を含む）。会長の行の旧版の `true` は引き継がれて出席となり、`false` はチェックなしのまま。`resolveImportedNeighborChecks` の `candidates` の先頭が `null`・オブジェクトでない要素、または氏名のある識別子を持たない要素で、2番目以降の候補が比較元になった場合は代替の比較元として扱う（会長以外の `true` は引き継がず、`false` と会長の行の値は引き継ぐ。`chairmanDefaults: false` でも同じ）。先頭の候補が比較元なら、会長以外の `true` も引き継ぐ。代表名簿が空枠だけのとき、出席セレクタで空枠を操作しても名簿の異なる同名エントリの別人へは同期されず、(a) そのエントリの地区ファイル取込で代表になる場合、(b) 代表の班を名簿なしで再提出し写し元の名簿へ縮む場合、(c) 自治会ファイルを取り込む場合のいずれでも、別人は出席セレクタ・印刷・座席候補で出席にならない。名簿のない地区ファイルで新しい班を加える場合（置き換えるエントリがなく別エントリの名簿を写す）、代表は入れ替わらず、加えたエントリは代表名簿の出席を本人単位で引き継いで会長の自動チェックをせず、同名の他エントリ（写し元を含む）は作り直されて旧版の同期値と氏名のない行の `true` が解除される。写した名簿で重複する本人は、名簿の変わらない代表エントリで一意なら出席のまま（写した名簿の重複で解除しない）。置き換えない同名エントリの名簿内で重複する氏名のある行は、`true`・`false` とも取込後に出席なしとなる（その本人が代表名簿・取込後の名簿で一意な場合も、取込後の名簿で重複する場合も）。代表組に氏名のある行がなく、取込後の名簿だけで揃える場合（揃える元の一部だけが除かれる場合）も、取込後の名簿と一意に一致する本人を揃え、一致しない行は出席なしとなる。旧版の行番号同期で、名簿の異なる置き換えない同名エントリの別人（氏名のある行）に `true` が付いて保存された後、代表エントリの名簿を縮める地区ファイルの取込で代表が入れ替わっても、その別人は出席セレクタ・印刷・座席候補で出席にならない。名簿のない自地区データの合算は、自エントリの名簿を写す場合は出席不変で同名の他エントリも不変、別エントリの名簿を写す場合は代表名簿の出席を本人単位で引き継いで会長の自動チェックなし、同名の他エントリは作り直し。`alignNeighborChecksToGroup` 単体: `sources` が非配列の場合、`null`・オブジェクトでない要素だけの場合、氏名のある識別子のない要素だけの場合は、全行がキーなしとなる（氏名のある行も出席なし）。それらの要素と使える要素が混在する場合は、除いた残りの要素で揃える。`checks` のない揃える元では当該行のキーを削除する。`options` の省略、`clearDuplicatesOf` が非配列の場合は空とみなし、`clearDuplicatesOf` に1件だけの識別子は解除しない。結果が元と同じなら `szNeighborChecks` は未定義のまま。`neighborhood` のないエントリには名簿の範囲外のキーを残さない。貼付読込の地区データ・自治会データは、地区ファイル・自治会ファイルと同じ規則に従う（作り直し・名簿のない取込を含む）。名簿のない地区ファイルの再取込で自エントリの名簿を写す場合は、そのエントリと同名の他エントリの氏名のない行の旧版の `true` は変わらない。別エントリの名簿を写す場合は、取込先（本人単位の引継ぎ）でも同名の他エントリ（作り直し）でも、氏名のない行は出席なしとなる。代表の班を名簿なしで再提出し、代表の名簿が写し元の短い名簿に縮んで、写し元（同数で先順）または第三のエントリが代表になる場合も、旧版の行番号同期で保存された古い値や旧版で氏名のない行に付いた `true` は出席セレクタ・印刷・座席候補に出ず、利用者が外した本人は出席にならず、チェックした本人は出席のまま（地区ファイル・自地区データの合算の両方）。差替え前の代表名簿で一意にチェック済みの本人が取込後の名簿で重複し、置き換えない同名エントリでは一意な場合、そのエントリでも出席なしとなり、出席セレクタ・座席候補の双方で出席にならない。名簿のない地区ファイルの再取込で自エントリの名簿を写す場合は、同名の他エントリの出席（古い同期値を含む）を変更しない。別エントリの名簿を写す場合は、同名の他エントリ（写し元を含む）を差替え前の代表名簿と写した後の名簿で本人単位に作り直す。取込で加わった会長が、名簿の異なる置き換えない同名エントリにもいる場合、(a) 代表エントリを印刷対象から外した後の取込、(b) 名簿が縮んで他のエントリが代表になる取込のいずれでも、出席セレクタ・印刷・座席候補で新会長が出席となる。行数最多のエントリを印刷対象から外した場合も、座席候補・印刷に使われるエントリの本人ごとの出席は代表名簿と同じ。取込後の印刷対象切替・地区削除・モーダル保存では、代表組のエントリの取込で付いた出席（新会長）は維持され、代表でない同名エントリのうち代表組と一致しない行の出席は解除され、一致する行は代表組の値となる。暗号化保存→ロック→解除で出席が復元され、出席セレクタの表示が新会長に付く。実Chromiumで自治会ファイル・地区ファイル取込の差替え後に出席チェックの表示が新会長に付き、再起動後も解除できる。 | `chairman-fiscal-year.test.js`、`headless-save-invariant.test.js`（取込の後の座席は「UI SPEC-Q2: after a district file import a seat stays only with the same chairman …」で実画面・座席表の印刷・実再起動を確認） |
| R-24 / E-12-06 / E-13-03 / I-12-09 / I-13-03 / SPEC-Q4 | `Date` 固定で1/1・3/31 23:59・4/1 0:00・12/31 23:59の前期・後期・通年が年度基準（I-13-03 の式）で、入力欄にも同じ日付が表示される。`getFiscalYear` の月境界・閏日・不正な日付・非 `Date`、`getPeriodPresetDates` の基準年省略・`NaN`・小数・`Infinity`・文字列・`null` が年度へ代替し、整数の基準年は優先。自動生成の休日欄は1〜3月のプリセットで前年度の祝日一覧に置き換わり（入力欄・モデルとも）、空・編集済み（文字列・配列）・下書きありの休日欄は変わらない。置換えを妨げるのは休日欄の下書きだけで、空欄にした休日欄の下書きも下書きとして空のまま採用され、自動生成の一覧へ戻らない。題名・終了日・開始日など他の項目だけの下書きがあっても休日欄は置き換わり、その下書きもプリセットの保存で採用される（未完成の終了日・開始日はプリセットの日付になる）。自動生成の判定には下書きでなく有効な開始日を使う（未完成の開始日の下書き 2029-0 があっても、有効な開始日 2028-04-06 の年の一覧は置き換わる）。配列（`{date,name}`）で持つ自動生成の一覧も置き換わり、文字列の一覧として保存される。自動生成の判定は、開始日があれば開始日の年と当年の一覧のどちらか（当年の前年・翌年や開始日の翌年の一覧は保持される。2月に開始日2026-10-01・2028〜2029年の一覧、5月に開始日2027-04-06・2028〜2029年または2026〜2027年の一覧は、プリセットの後も変わらず既定と判定されない）、開始日・終了日が空なら当年・前年・翌年の一覧のどれかとの一致である。2月に開始日2026-10-01・2027〜2028年の一覧（当年と一致し開始日の年と異なる）は置き換わる。2月に開始日2027-04-06・2026〜2027年の一覧（プリセットの年度と一致し、開始日の年・当年と異なる）は既定と判定されず、役員データとして扱われる。開始日なしでは、2月の2028〜2029年（翌年）・2027〜2028年（当年）・2026〜2027年（前年）の一覧と、5月の2026〜2027年（前年。年度2027の一覧へ置き換わる）・2028〜2029年（翌年）の一覧が、押す前に既定と判定されて置き換わる。2月・5月とも2029〜2030年・2025〜2026年の一覧は既定と判定されず保持される。休日欄が操作の年度の一覧と同じなら変わらない。生成範囲の内側の境界では、2000年5月（年度2000）に2000〜2001年の一覧、2100年2月（年度2099）に2099年だけの一覧へ置き換わる。生成範囲（2000〜2099年）外の年度では、2000年2月（年度1999）・2100年5月（年度2100）の固定時刻でもプリセットの期間は適用され、自動生成の休日欄は置き換わらず空にもならない。4〜12月でも前年度から持ち越した自動生成の一覧（開始日が前年度）は当年度の一覧に置き換わる。上限境界の設定で休日の置換えを伴うプリセットが上限を超えると（期間だけなら上限内で、置き換えた休日を含めると超える境界を含む）、期間・休日の有効値は変わらず、期間と置き換えた一覧が下書きにそろい、一覧が入力欄に残り、入力状態の案内（上限超過）が表示され、次のプリセットは休日を自動生成で置き換えず（上限内なら編集済みの下書きを期間とともに採用する）、ロック→解除できる。旗振り設定がない端末の初期期間・初期休日は1〜3月も従来どおり当年。1〜3月にプリセットで設定した前年度の前期と生成し直した休日は既定と判定され、期間の既定判定は暦年のまま（2027年2月に2028年の前期は既定、2025年の前期は役員データ）で、開始日の年とも当年とも異なる年の休日一覧は従来どおり既定と判定されない。実Chromiumで1〜3月の固定時刻にプリセット押下が前年度の日付と祝日一覧を表示する。 | `chairman-fiscal-year.test.js`、`security-save-invariant.test.js`、`headless-save-invariant.test.js` |
| R-24 / E-13-04 / SPEC-Q3 | 年度更新で旗振りの下書き（`inputDrafts`）と期間・名簿・休日・特別枠が破棄され、基本設定は維持される。取消時は下書きを含め変更しない。 | `chairman-fiscal-year.test.js` |

## 18. 意図しない外部通信の遮断（2.12.1、R-25）

| 要件・仕様・指摘 | 具体的な検査（正常系・境界値・異常系） | 対象テスト |
| :--- | :--- | :--- |
| R-25 / E-14-02 / I-14-01 | 配信するファイルが I-14-01 の範囲（直下の index.html・manifest.json・version.json・sw.js、css/・js/・icons/）だけで、HTML の文書は index.html だけ、直下に配信しないもの以外のファイル・ディレクトリがない。sw.js の `ASSETS` と index.html の `src`・`href` が指すファイルがすべて範囲に含まれる。範囲の外に置いた `help.html`・名前が `.js` で終わる合成のディレクトリ `js/vendor.js` の試料は検出される。手元のもの（名前が `.`・`#` で始まるもの、`~` で終わるもの、`Thumbs.db`）は、それだけを含む（または空の）ディレクトリとともに範囲に数えず走査もしない。一覧はディレクトリを読んで作り（Git に依存しない）、変異の試料の写しも同じ一覧から作る。写しに手元の設定・一時ファイル（入れ子の `icons/a/b/.DS_Store`・空の `css/new/` を含む）を置いても報告・走査されず、違反の字句を含む手元のファイルを置いた写しも静的試験に合格する。新しい `help.html`・`ヘルプ.html`・`js/vendor/`・`icons/old/legacy.html`・入れ子の `vendor/lib/help.html`・`css/theme/dark/x.css`、配信する拡張子で終わる名前のディレクトリ（`icons/set.png/`・`js/lib.js/`）、手元のものの規則の境界の名前（`help~old.html`・`a#b.html`・`_help.html`）、配信するディレクトリの直下の拡張子の違うファイル（`js/app.js.map`・`js/help.html`・`css/font.woff2`・`icons/photo.jpg`・`icons/x.js`）は報告され、`js/_x.js` は走査される。 | `csp-external-block.test.js`（静的） |
| R-25 / E-14-01・02・03 / I-14-01 | head の先頭が `<meta charset>`、その直後が E-14-01 と完全一致する CSP（1つだけ）、続いて referrer（`no-referrer`）と x-dns-prefetch-control（`off`）。CSP より前に資源を要求する要素がなく、`<base>`・meta refresh もない。`default-src`・`frame-src`・`object-src`・`base-uri`・`form-action`・`script-src-attr` は `'none'`、必要な種類だけ `'self'`、`style-src` だけ `'unsafe-inline'` を加える。ホスト・スキーム・`data:` の許可元がなく、`font-src`・`media-src`・`child-src`・`prefetch-src`・`report-uri`・`report-to` を指定しない。 | `csp-external-block.test.js`（静的） |
| R-25 / E-14-01 / I-14-01 | `'unsafe-inline'` は style 属性と印刷の向きの `<style>` 要素に必要（`style-src` に置き、`style-src-attr` だけに絞らない）。 | `csp-external-block.test.js`（静的）、既存の旗振り印刷の実Chromium 試験 |
| R-25 / E-14-04・05 / I-14-02 | アプリのファイル（アイコンの SVG を含む）の URL（I-14-02 の定義。プロトコル名だけの比較の文字列と SVG の名前空間は除く）は、LINE の共有先（3か所）と `mailto:`（3か所）だけ。`file:`・`javascript:`・`data:`・`blob:` の URL、プロトコル相対の URL（`\\fileserver` などのドットのないホスト・数値の IPv4・IPv6 を含む）がない。manifest.json の URL が相対。`fetch` は version.json と Service Worker の資産だけ、Service Worker の登録は `./sw.js` だけ、他の通信 API（`WebTransport`・`fetchLater`・別名を含む WebRTC・音声の認識と読み上げ・`geolocation`・`PaymentRequest`・`PresentationRequest`・`postMessage`・`BroadcastChannel`・`MessageChannel`・ブラウザ内蔵の AI の API を含む。名前は大文字小文字を区別した部分一致）を使わず、`opener`・`parent` の出現がない。WebAuthn の `publicKey` の選択肢3か所の全行と `WEBAUTHN_USER_ID` の定義が行の内容で固定され（複数行の `user` の書換え・`largeBlob` の追加の試料も検出する）、`extensions` は `prf` だけ、`largeBlob`・`credBlob`・`rpId` がない。sw.js は `redirect`・`Refresh` を使わない（`Location` は `location` の固定で検出）。`stun:`・`turn:` などの URL もない。`href`・`open`・`navigate`・`location`・`hostname`・`protocol`・`newUrl`・`lineUrl`・`mailUrl`・`fetch`・`credentials`・`publicKey` の出現（書き方を問わない）と、`downloadTextFile`・`buildExternalBrowserUrl` の本体が許可リストのファイル・行の内容（行番号ではない）・件数と一致し（許可した行の書換え・別ファイルへの移動・`location` の別名の試料も検出する）、`host`・`port` の出現と、`host`・`hostname`・`protocol`・`port` への代入（`Object.assign` のキーを含む）がなく、`openWindow`・`rel`・`ping`・`http-equiv` の出現がない。sw.js は Cache の `add`・`addAll` を使わず、`put` 2か所・`clients.claim()` 1か所だけ。`fetch` の呼出しは js/app.js 1か所・sw.js 3か所。`open(` は共有の `window.open` 6か所（`noopener,noreferrer`）と sw.js の `caches.open` 2か所だけ。`location` の操作は更新の `replace`・`href`、メール共有の `href`、全消去後の `reload()` だけで、属性への代入・添字・`assign` はない。`navigation.navigate`・`submit()`・`requestSubmit()` がない。js の HTML 文字列にリンク・meta・フォーム・入れ子文書・script のタグと `href=`・`rel=` などの属性がなく、それらの要素の生成はファイルの保存の `a` だけ。`.href` への代入はファイルの保存と LINE 内ブラウザ向けのリンクと上記の `location.href` だけ、`rel` などの操作がなく、index.html の `rel` は許可した値だけ、資源ヒントがない。sw.js の `clients` の操作は `claim()` だけで、`navigate(`・`openWindow` などがない。ファイルの中に置く形の試料は、配信するファイルの写しに加えて静的試験を子プロセスで実行し、失敗することを確かめる（変更しない写しは合格）。照合はコメントと正規表現リテラルを字句解析で取り除いた内容に対して行い（`++`・`--` の後の `/` は除算。取り除いた後のコードが構文として正しい）、大文字小文字・`\`・特別スキームのスラッシュの有無・`=` の前後の空白を区別しない（字句解析が現行コードのコメントと正規表現だけを取り除くことも確かめる）。各規則に違反の試料（Gate 1 で実証された形を含む）を与えると検出され、除外する形（`'https:'`・SVG の名前空間・`x-dns-prefetch-control`・`caches.open`・文中の「file:」・キーの `data:`・旗振りの場所の項目名の `location`・正規表現リテラル・`rows:5`）は検出されない。 | `csp-external-block.test.js`（静的） |
| R-25 / E-14-01 / I-14-03 | 実Chromium（file 起動）の陽性の対照: CSP を持たない対照ページで、各手段の送信が CDP の要求（WebSocket は作成）として観測され、fetch・XHR・EventSource・`import()`・`@font-face`・マニフェスト（`Page.getAppManifest`）は試験用サーバーも受信する。アプリのページ: 通常の起動で CSP 違反0件。外部オリジンへの fetch・XHR・WebSocket・EventSource・sendBeacon・ping（`connect-src`）、画像・`url()`（`img-src`）、script・`import()`（`script-src-elem`）、stylesheet・`@import`（`style-src-elem`）、`@font-face`（`font-src`）、video（`media-src`）、object（`object-src`）、iframe（`frame-src`）、form の送信（`form-action`）、prefetch（`default-src`）、アイコンの link（`img-src`）、`Page.getAppManifest` によるマニフェスト（`manifest-src`）が、それぞれの違反として拒否される（`blockedURI` は手段ごとの期待値: 入れ子文書・object はオリジンだけ、WebSocket は `ws:` の URL、それ以外は要求の URL）。`blob:`・`data:` の Worker は対照では実行され、アプリでは `worker-src` の違反になる。対照でサーバーが受信する6つの手段（fetch・XHR・EventSource・`import()`・`@font-face`・マニフェスト）は、アプリのページでは受信0件。外部の宛先への `requestWillBeSent` が出たものはすべて `blockedReason: 'csp'` で失敗する（手段によっては CDP に現れず、違反イベントだけが根拠になる）。ページは form の送信先へ移動しない。 | `headless-csp-external.test.js`（実Chromium） |
| R-25 / E-14-04 / I-14-02・03 | 差し替えない `downloadTextFile` でファイルが保存され、内容が一致し、CSP 違反0件。 | `headless-csp-external.test.js`（実Chromium） |
| R-25 / E-14-03 / I-14-02・03 | `<body>` に `spellcheck="false"` と `writingsuggestions="false"` があり、index.html と js のこれらの名前は値が `false` の属性・代入だけ（`.spellcheck` は真偽値の `false` だけで文字列の `'false'` を許さない。`setAttribute`・`toggleAttribute`・`removeAttribute`、`true`・空の値・値なしがない。試料で検出力を確かめる）。実Chromium で地区モードの入力欄と後から作った入力欄の `spellcheck` が `false`、`writingSuggestions` が `'false'`。 | `csp-external-block.test.js`（静的）、`headless-csp-external.test.js`（実Chromium） |
| R-25 / E-14-01 / I-14-03 | 既存の実Chromium 試験一式が新しい CSP のもとで合格する。SEC-34 の3件は、同一オリジンの入れ子文書に代えて、試験から開いた別ウィンドウで複数タブを再現する。 | `tests/system/headless-*.test.js`、`headless-save-invariant.test.js` の UI SEC-34 |
| E-14-05 / I-14-03 | `frame-ancestors`・`sandbox` は配信側の HTTP 応答ヘッダーが必要で、ローカルでは未検証。HTTP 配信での実ブラウザの確認（Service Worker の登録・更新、自オリジンのマニフェストの取得）も未検証で、Service Worker の処理は静的試験だけで固定する。外部オリジンの Worker は file 起動では CSP より前に例外となるため実ブラウザでは確かめない（`worker-src` は `blob:`・`data:` の Worker で確かめる）。利用者が操作・設定するブラウザ自身の機能（翻訳など）は範囲外。拒否される iframe・form の送信の名前解決・接続の先行と、file 起動の `'self'` がホスト付きの file: URL に一致すること（Windows の UNC は未確認）は、残余として記録する。配信側が配信しないもの（docs/・tests/・README.md など）と手元のもの（`Thumbs.db` を含む）を公開しないことは、配信側の前提として未検証。 | — |
