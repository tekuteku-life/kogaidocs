/* =========================================================================
   アプリケーション初期化・タブ切替・PWA・セキュリティUI
========================================================================= */

const CURRENT_APP_VERSION = "2.4.0";
let deferredInstallPrompt = null;

function switchTab(mode) {
	const tabD = document.getElementById('tab-district');
	const tabR = document.getElementById('tab-rep');
	const tabN = document.getElementById('tab-neighbor');
	const tabT = document.getElementById('tab-transfer');
	if (tabD) tabD.style.display = mode === 'district' ? 'block' : 'none';
	if (tabR) tabR.style.display = mode === 'rep' ? 'block' : 'none';
	if (tabN) tabN.style.display = mode === 'neighbor' ? 'block' : 'none';
	if (tabT) tabT.style.display = mode === 'transfer' ? 'block' : 'none';

	const btns = document.querySelectorAll('.tab-btn');
	if (btns.length >= 4) {
		btns[0].classList.toggle('active', mode === 'district');
		btns[1].classList.toggle('active', mode === 'rep');
		btns[2].classList.toggle('active', mode === 'neighbor');
		btns[3].classList.toggle('active', mode === 'transfer');
	} else if (btns.length >= 3) {
		btns[0].classList.toggle('active', mode === 'district');
		btns[1].classList.toggle('active', mode === 'rep');
		btns[2].classList.toggle('active', mode === 'neighbor');
	} else if (btns.length >= 2) {
		btns[0].classList.toggle('active', mode === 'district');
		btns[1].classList.toggle('active', mode === 'rep');
	}

	// モード選択状態の永続化
	try {
		localStorage.setItem('kogai_active_mode', mode);
	} catch (e) {
		console.warn("Failed to persist active mode", e);
	}

	// モード選択肢の動的折りたたみUX
	const btnContainer = document.getElementById('mode-tab-buttons');
	const badge = document.getElementById('mode-active-badge');
	const badgeText = document.getElementById('mode-active-badge-text');
	const activeBadge = document.getElementById('active-mode-badge');

	if (btnContainer) {
		btnContainer.style.display = 'none';
	}
	if (badge) {
		badge.style.display = 'inline-flex';
	}
	if (badgeText) {
		if (mode === 'district') {
			badgeText.textContent = '① 各地区役員モード ▼ [モード切替]';
		} else if (mode === 'rep') {
			badgeText.textContent = '② 校外代表モード ▼ [モード切替]';
		} else if (mode === 'neighbor') {
			badgeText.textContent = '③ 自治会役員名簿モード ▼ [モード切替]';
		} else if (mode === 'transfer') {
			badgeText.textContent = '④ 転入者モード ▼ [モード切替]';
		}
	}
	if (activeBadge) {
		if (mode === 'district') {
			activeBadge.textContent = '地区役員モード';
		} else if (mode === 'rep') {
			activeBadge.textContent = '校外代表モード';
		} else if (mode === 'neighbor') {
			activeBadge.textContent = '自治会役員名簿';
		} else if (mode === 'transfer') {
			activeBadge.textContent = '転入者モード';
		}
	}
}

/**
 * 直前のアクティブモードを復元します（ホワイトリスト検証）
 */
function restoreActiveMode() {
	try {
		const savedMode = localStorage.getItem('kogai_active_mode');
		const whitelist = ['district', 'rep', 'neighbor', 'transfer'];
		if (savedMode && whitelist.includes(savedMode)) {
			switchTab(savedMode);
		} else {
			switchTab('district');
		}
	} catch (e) {
		switchTab('district');
	}
}

/**
 * モード選択肢の折りたたみ・再展開を切り替えます
 */
function toggleModeSelector() {
	const btnContainer = document.getElementById('mode-tab-buttons');
	const badge = document.getElementById('mode-active-badge');
	if (!btnContainer) return;
	const isCollapsed = btnContainer.style.display === 'none';
	if (isCollapsed) {
		btnContainer.style.display = 'flex';
		if (badge) badge.style.display = 'none';
	} else {
		btnContainer.style.display = 'none';
		if (badge) badge.style.display = 'inline-flex';
	}
}

/**
 * PWA・ブラウザアプリのURLを他役員へ共有します
 */
async function shareAppUrl() {
	const shareData = {
		title: "校外委員会 名簿・帳票作成システム",
		text: "校外委員会および自治会の名簿・帳票作成ツールです。",
		url: window.location.href
	};

	if (navigator.share) {
		try {
			await navigator.share(shareData);
			return;
		} catch (err) {
			if (err && err.name === 'AbortError') {
				return;
			}
		}
	}

	if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
		try {
			await navigator.clipboard.writeText(shareData.url);
			alert("アプリのURLをクリップボードにコピーしました。\nLINEやメールに貼り付けて共有してください。");
			return;
		} catch (e) {}
	}

	prompt("アプリのURLをコピーして共有してください:", shareData.url);
}

/**
 * PWAのインストールを促すダイアログを開きます
 */
function triggerPwaInstall() {
	if (deferredInstallPrompt) {
		deferredInstallPrompt.prompt();
		deferredInstallPrompt.userChoice.then((choiceResult) => {
			deferredInstallPrompt = null;
			const installBtn = document.getElementById('pwa-install-btn');
			if (installBtn) installBtn.style.display = 'none';
		});
	}
}

/**
 * ヘッダーのセキュリティ状態バッジを更新します
 * @param {'locked' | 'unlocked' | 'unencrypted'} status
 */
function updateSecurityBadge(status) {
	const badge = document.getElementById('storage-security-badge');
	if (!badge) return;

	badge.classList.remove('is-locked', 'is-encrypted', 'is-plain');

	if (status === 'locked') {
		badge.classList.add('is-locked');
		badge.innerHTML = '🔒 データロック中 <span class="badge-hint">（クリックして解除）</span>';
		badge.title = "データは暗号化保護されています。クリックしてロックを解除してください。";
	} else if (status === 'unlocked') {
		badge.classList.add('is-encrypted');
		const meta = getStorageAuthMeta();
		const hasBio = meta && meta.webauthn;
		badge.innerHTML = `🛡️ 暗号化保護中${hasBio ? '（生体認証連携）' : ''} <span class="badge-hint">（設定）</span>`;
		badge.title = "端末内保存データはAES-256-GCMで暗号化されています。クリックでセキュリティ設定を開きます。";
	} else {
		badge.classList.add('is-plain');
		badge.innerHTML = '🔓 ストレージ未暗号化 <span class="badge-hint">（安全のため設定推奨）</span>';
		badge.title = "端末内に平文で保存されています。クリックしてパスワード・生体認証による暗号化を設定できます。";
	}
}

/**
 * ロック解除モーダルを表示します
 */
function showStorageUnlockModal() {
	const modal = document.getElementById('storage-lock-modal');
	if (!modal) return;
	modal.style.display = 'flex';

	const meta = getStorageAuthMeta();
	const webauthnSection = document.getElementById('webauthn-unlock-section');
	if (webauthnSection) {
		if (meta && meta.webauthn && isWebAuthnAvailable()) {
			webauthnSection.style.display = 'block';
		} else {
			webauthnSection.style.display = 'none';
		}
	}

	const errEl = document.getElementById('modal-unlock-error');
	if (errEl) errEl.textContent = "";

	const passInput = document.getElementById('modal-unlock-pass');
	if (passInput) {
		passInput.value = "";
		setTimeout(() => passInput.focus(), 100);
	}
}

/**
 * ロック解除モーダルを閉じます
 */
function hideStorageUnlockModal() {
	const modal = document.getElementById('storage-lock-modal');
	if (modal) modal.style.display = 'none';
}

/**
 * 生体認証（WebAuthn PRF）によるロック解除を実行します
 * @param {boolean} [silent=false]
 */
async function handleWebAuthnUnlock(silent = false) {
	const errEl = document.getElementById('modal-unlock-error');
	if (errEl) errEl.textContent = "";

	try {
		await unlockStorageWithWebAuthn();
		hideStorageUnlockModal();
		updateSecurityBadge('unlocked');
		await loadAppDataFromStorage();
		renderDistrictForm();
		renderRepAll();
		if (typeof renderNeighborForm === 'function') renderNeighborForm();
		if (typeof loadTransferLocal === 'function') await loadTransferLocal();
		if (typeof renderTransferForm === 'function') renderTransferForm();
		setAllCardsCollapse(true, 'tab-district');
		setAllCardsCollapse(true, 'tab-rep');
		setAllCardsCollapse(true, 'tab-neighbor');
		setAllCardsCollapse(true, 'tab-transfer');
		resetAutoLockTimer();
	} catch (err) {
		console.warn("WebAuthn unlock failed:", err);
		if (!silent && errEl) {
			errEl.textContent = err.message || "生体認証に失敗しました。パスワードで解除してください。";
		}
	}
}

/**
 * パスワードによるロック解除を実行します
 */
async function handlePasswordUnlock() {
	const passInput = document.getElementById('modal-unlock-pass');
	const errEl = document.getElementById('modal-unlock-error');
	if (errEl) errEl.textContent = "";

	const password = passInput ? passInput.value : "";
	if (!password) {
		if (errEl) errEl.textContent = "パスワードを入力してください。";
		return;
	}

	try {
		await unlockStorageWithPassword(password);
		hideStorageUnlockModal();
		updateSecurityBadge('unlocked');
		await loadAppDataFromStorage();
		renderDistrictForm();
		renderRepAll();
		if (typeof renderNeighborForm === 'function') renderNeighborForm();
		if (typeof loadTransferLocal === 'function') await loadTransferLocal();
		if (typeof renderTransferForm === 'function') renderTransferForm();
		setAllCardsCollapse(true, 'tab-district');
		setAllCardsCollapse(true, 'tab-rep');
		setAllCardsCollapse(true, 'tab-neighbor');
		setAllCardsCollapse(true, 'tab-transfer');
		resetAutoLockTimer();
	} catch (err) {
		console.warn("Password unlock failed:", err);
		if (errEl) {
			errEl.textContent = "パスワードが正しくないか、復号に失敗しました。";
		}
	}
}

/**
 * 保存データの消去・初期化を確認して実行します
 */
function handleResetStorageConfirm() {
	const ok = confirm("【警告】端末内に保存されている地区データ・代表データ・暗号化キーをすべて消去しますか？\n\n※提出・保存用.txtファイルをお持ちであれば後から再読み込み可能です。");
	if (ok) {
		clearStorageSecurity();
		location.reload();
	}
}

/**
 * セキュリティ設定モーダルを開きます
 */
function openStorageSettingsModal() {
	const modal = document.getElementById('storage-settings-modal');
	const bodyEl = document.getElementById('settings-modal-body');
	if (!modal || !bodyEl) return;

	const meta = getStorageAuthMeta();
	const isEnc = isStorageEncrypted();
	const hasBio = meta && meta.webauthn;
	const bioAvailable = isWebAuthnAvailable();

	const versionHtml = `
		<hr style="margin:20px 0 16px 0; border:none; border-top:1px solid var(--border);">
		<div class="version-section">
			<div style="font-weight:bold; font-size:0.95rem; margin-bottom:4px; color:var(--text);">ℹ️ アプリバージョン情報</div>
			<div style="font-size:0.88rem; color:#475569; margin-bottom:8px;">
				現在のバージョン: <strong>v${CURRENT_APP_VERSION}</strong>
			</div>
			<button type="button" class="btn btn-outline btn-sm" id="btn-manual-check-update" onclick="checkAppVersion(true)">
				🔄 最新バージョンを確認・更新
			</button>
			<div id="version-check-status" style="font-size:0.82rem; margin-top:6px; color:#64748b;"></div>
		</div>
	`;

	let html = "";

	if (!isEnc) {
		html = `
			<p class="modal-desc">
				現在、ブラウザのローカルストレージに個人情報が平文で保存されています。<br>
				パスワードおよび生体認証（Touch ID / Windows Hello / 指紋認証等）を設定して、<strong>AES-256-GCM暗号化</strong>を有効化することをお勧めします。
			</p>
			<div class="form-group" style="margin-bottom:12px;">
				<label>暗号化パスワード（半角英数大文字・小文字・記号12文字以上）</label>
				<div class="pass-input-group">
					<input type="password" id="modal-set-pass" placeholder="半角英数記号12文字以上" inputmode="latin" autocorrect="off" autocapitalize="off" spellcheck="false" oninput="sanitizePasswordInput(this); validateModalPasswords();">
					<button type="button" class="btn-toggle-pass" onclick="togglePasswordVisibility('modal-set-pass', this)" title="表示/非表示">👁️</button>
				</div>
			</div>
			<div class="form-group" style="margin-bottom:12px;">
				<label>確認用パスワード（二度入力）</label>
				<div class="pass-input-group">
					<input type="password" id="modal-set-pass-confirm" placeholder="もう一度入力" inputmode="latin" autocorrect="off" autocapitalize="off" spellcheck="false" oninput="sanitizePasswordInput(this); validateModalPasswords();">
					<button type="button" class="btn-toggle-pass" onclick="togglePasswordVisibility('modal-set-pass-confirm', this)" title="表示/非表示">👁️</button>
				</div>
			</div>
			<div id="modal-set-pass-msg" class="pass-feedback-msg" style="margin-bottom:12px;"></div>
			${bioAvailable ? `
				<label class="check-item" style="margin-bottom:16px;">
					<input type="checkbox" id="modal-set-enable-bio" checked>
					生体認証（Touch ID / Face ID / Windows Hello等）も有効にする（次回から1タップで解除）
				</label>
			` : `
				<div class="help-text" style="margin-bottom:16px;">
					※生体認証（WebAuthn）はHTTPS環境またはlocalhostでご利用いただけます。（現在の環境ではパスワード暗号化のみ有効になります）
				</div>
			`}
			<div class="flex-row" style="justify-content:flex-end; gap:8px;">
				<button type="button" class="btn btn-outline" onclick="closeStorageSettingsModal()">キャンセル</button>
				<button type="button" class="btn" id="modal-btn-enable-enc" onclick="handleEnableEncryptionSubmit()">🔒 暗号化を有効化</button>
			</div>
			${versionHtml}
		`;
	} else {
		html = `
			<div class="status-summary-box" style="margin-bottom:16px; padding:12px; background:var(--primary-light); border:1px solid #bfdbfe; border-radius:6px;">
				<div style="font-weight:bold; color:var(--primary); margin-bottom:4px;">🛡️ 端末内保存データは暗号化されています</div>
				<div style="font-size:0.88rem; color:#334155;">暗号化方式: AES-256-GCM + PBKDF2（100,000回ストレッチング）</div>
				<div style="font-size:0.88rem; color:#334155; margin-top:4px;">
					生体認証連携: ${hasBio ? '<span style="color:var(--success); font-weight:bold;">✅ 有効（登録済み）</span>' : '<span style="color:#d97706; font-weight:bold;">⚠️ 未登録</span>'}
				</div>
			</div>
			<div class="flex-col" style="gap:10px;">
				${bioAvailable ? `
					<button type="button" class="btn btn-outline" onclick="handleAddOrUpdateBiometric()">
						👆 生体認証（Touch ID / Windows Hello等）を${hasBio ? '再登録' : '追加登録'}する
					</button>
				` : ''}
				<button type="button" class="btn btn-outline" onclick="handleImmediateLock()">
					🔒 今すぐストレージをロックする
				</button>
				<button type="button" class="btn btn-danger btn-sm" style="margin-top:10px;" onclick="handleResetStorageConfirm()">
					🗑️ 保存データを全消去して初期化
				</button>
			</div>
			${versionHtml}
			<div class="flex-row" style="justify-content:flex-end; margin-top:16px;">
				<button type="button" class="btn btn-outline" onclick="closeStorageSettingsModal()">閉じる</button>
			</div>
		`;
	}

	bodyEl.innerHTML = html;
	modal.style.display = 'flex';
}

/**
 * セキュリティ設定モーダルを閉じます
 */
function closeStorageSettingsModal() {
	const modal = document.getElementById('storage-settings-modal');
	if (modal) modal.style.display = 'none';
}

/**
 * セキュリティ設定モーダル内のパスワード入力一致チェック
 */
function validateModalPasswords() {
	const p1 = document.getElementById('modal-set-pass')?.value || "";
	const p2 = document.getElementById('modal-set-pass-confirm')?.value || "";
	const msgEl = document.getElementById('modal-set-pass-msg');
	if (!msgEl) return;

	if (!p1 && !p2) {
		msgEl.textContent = "";
		msgEl.className = "pass-feedback-msg";
		return;
	}

	const v = validatePassword(p1);
	if (!v.valid) {
		msgEl.textContent = "⚠️ " + v.message;
		msgEl.className = "pass-feedback-msg mismatch";
		return;
	}

	if (p2 && p1 !== p2) {
		msgEl.textContent = "⚠️ パスワードが一致していません。";
		msgEl.className = "pass-feedback-msg mismatch";
		return;
	}

	if (p1 === p2) {
		msgEl.textContent = "✅ パスワードの強度および一致が確認できました。";
		msgEl.className = "pass-feedback-msg match";
	} else {
		msgEl.textContent = "ℹ️ 確認のためもう一度同じパスワードを入力してください。";
		msgEl.className = "pass-feedback-msg";
	}
}

/**
 * 設定モーダルからストレージ暗号化の有効化を実行します
 */
async function handleEnableEncryptionSubmit() {
	const p1 = document.getElementById('modal-set-pass')?.value || "";
	const p2 = document.getElementById('modal-set-pass-confirm')?.value || "";
	const enableBio = document.getElementById('modal-set-enable-bio')?.checked || false;

	const v = validatePassword(p1);
	if (!v.valid) {
		alert(v.message);
		return;
	}
	if (p1 !== p2) {
		alert("確認用パスワードが一致していません。");
		return;
	}

	try {
		const result = await setupStorageEncryption(p1, enableBio);
		alert(`端末内保存（LocalStorage）の暗号化を有効化しました！\n${result.biometric ? '生体認証（WebAuthn）も登録完了しました。次回から生体認証でワンタッチ解除可能です。' : ''}`);
		closeStorageSettingsModal();
		updateSecurityBadge('unlocked');
	} catch (err) {
		alert("暗号化の有効化に失敗しました: " + err.message);
	}
}

/**
 * 生体認証の追加・再登録を実行します
 */
async function handleAddOrUpdateBiometric() {
	try {
		await registerWebAuthnForActiveKey();
		alert("生体認証（WebAuthn PRF）の登録が完了しました！\n次回以降、生体認証でワンタッチ解除できます。");
		openStorageSettingsModal();
	} catch (err) {
		alert("生体認証の登録に失敗しました: " + err.message);
	}
}

/**
 * ロック時にメモリ内データとDOMを初期化して画面からの情報漏洩を防ぎます
 */
function clearMemoryAndDomForLock() {
	if (typeof currentDistrict !== 'undefined') {
		currentDistrict.district = "";
		currentDistrict.han = "";
		currentDistrict.hanList = [];
		delete currentDistrict.savedFilePassword;
		currentDistrict.officers = [
			{
				lastName: "", firstName: "", lastNameKana: "", firstNameKana: "",
				role: "校外委員", han: "", tel: "", email: "", address: "",
				childGrade: "", childClass: "", childLastName: "", childFirstName: "",
				childLastNameKana: "", childFirstNameKana: ""
			}
		];
		currentDistrict.neighborhood = [{ role: "会長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "" }];
		currentDistrict.students = [{ grade: "1", class: "", han: "", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "", leader: "", isOutOfDistrict: false }];
	}
	if (typeof repState !== 'undefined') {
		repState.districts = [];
	}
	if (typeof neighborState !== 'undefined') {
		neighborState.district = "";
		neighborState.neighborhood = [
			{ role: "会長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "", email: "", note: "" },
			{ role: "副会長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "", email: "", note: "" }
		];
	}
	const dPass = document.getElementById('d-pass');
	if (dPass) dPass.value = "";
	const dPassConfirm = document.getElementById('d-pass-confirm');
	if (dPassConfirm) dPassConfirm.value = "";
	const dPassOptin = document.getElementById('d-save-password-optin');
	if (dPassOptin) dPassOptin.checked = false;
	const nImportPass = document.getElementById('neighbor-import-pass');
	if (nImportPass) nImportPass.value = "";

	if (typeof renderDistrictForm === 'function') renderDistrictForm();
	if (typeof renderRepAll === 'function') renderRepAll();
	if (typeof renderNeighborForm === 'function') renderNeighborForm();
	if (typeof clearTransferForm === 'function') clearTransferForm();
	const printArea = document.getElementById('print-area');
	if (printArea) printArea.innerHTML = "";
}

let autoLockTimer = null;
const AUTO_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

function resetAutoLockTimer() {
	if (autoLockTimer) {
		clearTimeout(autoLockTimer);
		autoLockTimer = null;
	}
	if (isStorageEncrypted() && isStorageUnlocked()) {
		autoLockTimer = setTimeout(() => {
			handleImmediateLock();
		}, AUTO_LOCK_TIMEOUT_MS);
		if (autoLockTimer && typeof autoLockTimer.unref === 'function') {
			autoLockTimer.unref();
		}
	}
}

function initAutoLockListeners() {
	if (typeof window === 'undefined') return;
	['pointerdown', 'keydown', 'touchstart'].forEach(evt => {
		window.addEventListener(evt, resetAutoLockTimer, { passive: true });
	});
	if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
		document.addEventListener('visibilitychange', () => {
			if (document.hidden && isStorageEncrypted() && isStorageUnlocked()) {
				resetAutoLockTimer();
			}
		});
	}
}

/**
 * 今すぐストレージをロックします
 */
function handleImmediateLock() {
	lockStorage();
	clearMemoryAndDomForLock();
	closeStorageSettingsModal();
	updateSecurityBadge('locked');
	showStorageUnlockModal();
}

/**
 * カード6または代表カード1のパスワード入力からワンクリックでストレージ暗号化を適用
 * @param {string} inputId
 */
async function quickSetupEncryptionFromCard(inputId) {
	const pEl = document.getElementById(inputId);
	const password = (pEl && pEl.value) ? pEl.value : (typeof inputId === 'string' ? inputId : "");
	const v = validatePassword(password);
	if (!v.valid) {
		alert(v.message);
		return;
	}

	// 既にストレージ暗号化が有効な場合、WebAuthn再登録を促さず既存暗号化ストレージに保存（一本化）
	if (isStorageEncrypted() && isStorageUnlocked()) {
		currentDistrict.savedFilePassword = password;
		const optinEl = document.getElementById('d-save-password-optin');
		if (optinEl) optinEl.checked = true;
		const passEl = document.getElementById('d-pass');
		if (passEl) passEl.value = password;
		await saveDistrictLocal();
		alert("ファイル保存用パスワードを暗号化ストレージに記憶しました。");
		return;
	}

	const bioAvailable = isWebAuthnAvailable();
	let enableBio = false;
	if (bioAvailable) {
		enableBio = confirm("生体認証（Touch ID / Windows Hello / 指紋認証等）も合わせて登録しますか？\n（[OK]を押すと指紋または顔認証の登録画面が開きます）");
	}

	try {
		const result = await setupStorageEncryption(password, enableBio);
		currentDistrict.savedFilePassword = password;
		const optinEl = document.getElementById('d-save-password-optin');
		if (optinEl) optinEl.checked = true;
		const passEl = document.getElementById('d-pass');
		if (passEl) passEl.value = password;
		await saveDistrictLocal();
		alert(`このパスワードで端末内保存（LocalStorage）の暗号化を有効化しました！\n${result.biometric ? '生体認証の登録も完了しました。' : ''}`);
		updateSecurityBadge('unlocked');
	} catch (err) {
		alert("暗号化設定に失敗しました: " + err.message);
	}
}

/**
 * ストレージから復号してアプリデータをロード・正規化します
 */
async function loadAppDataFromStorage() {
	try {
		const savedD = await loadStorageDecrypted('kogai_district_v2');
		if (savedD && typeof savedD === 'object') {
			currentDistrict = savedD;
		}
	} catch (e) {
		console.warn("Failed to load district data:", e);
	}

	if (!currentDistrict.officers || !Array.isArray(currentDistrict.officers) || currentDistrict.officers.length === 0) {
		currentDistrict.officers = [currentDistrict.officer || {}];
	}
	delete currentDistrict.officer;
	currentDistrict.officers.forEach(off => {
		normalizeOfficerChildNames(off);
		normalizeNameFields(off);
	});

	if (currentDistrict.han === undefined) {
		currentDistrict.han = "";
	}
	if (!currentDistrict.hanList || !Array.isArray(currentDistrict.hanList)) {
		currentDistrict.hanList = getDistrictHanList(currentDistrict);
	}

	if (!currentDistrict.neighborhood || currentDistrict.neighborhood.length === 0) {
		currentDistrict.neighborhood = [{ role: "会長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "" }];
	} else {
		currentDistrict.neighborhood.forEach(normalizeNameFields);
	}

	if (!currentDistrict.students || currentDistrict.students.length === 0) {
		currentDistrict.students = [{ grade: "6", class: "1", han: currentDistrict.han || "", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "", leader: "", isOutOfDistrict: false }];
	} else {
		currentDistrict.students.forEach(s => {
			normalizeNameFields(s);
			if (s.han === undefined) s.han = currentDistrict.han || "";
			if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
		});
	}

	try {
		const savedR = await loadStorageDecrypted('kogai_rep_v2');
		if (savedR && typeof savedR === 'object') {
			repState = savedR;
		}
	} catch (e) {
		console.warn("Failed to load rep data:", e);
	}

	if (repState.districts && Array.isArray(repState.districts)) {
		repState.districts.forEach(d => {
			if (d.han === undefined) d.han = "";
			if (d.hanList === undefined) d.hanList = getDistrictHanList(d);
			if (!d.officers || !Array.isArray(d.officers) || d.officers.length === 0) {
				d.officers = [d.officer || {}];
			}
			delete d.officer;
			d.officers.forEach(off => {
				normalizeOfficerChildNames(off);
				normalizeNameFields(off);
			});
			(d.neighborhood || []).forEach(normalizeNameFields);
			(d.students || []).forEach(s => {
				normalizeNameFields(s);
				if (s.han === undefined) s.han = d.han || "";
				if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
			});
		});
	}
	if (repState.szExternals && Array.isArray(repState.szExternals)) {
		repState.szExternals.forEach(normalizeNameFields);
	}

	try {
		const savedN = await loadStorageDecrypted('kogai_neighbor_v2');
		if (savedN && typeof savedN === 'object') {
			neighborState = savedN;
		}
	} catch (e) {
		console.warn("Failed to load neighbor data:", e);
	}

	if (!neighborState.neighborhood || !Array.isArray(neighborState.neighborhood) || neighborState.neighborhood.length === 0) {
		neighborState.neighborhood = [
			{ role: "会長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "", email: "", note: "" },
			{ role: "副会長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "", email: "", note: "" }
		];
	} else {
		neighborState.neighborhood.forEach(normalizeNameFields);
	}
}

/**
 * PWAアプリのバージョンを確認し、最新版があればアップデートを促します
 * @param {boolean} [isManual=false] 手動実行（設定画面から）かどうか
 */
async function checkAppVersion(isManual = false) {
	if (typeof navigator !== 'undefined' && !navigator.onLine) {
		if (isManual) {
			alert("オフラインのためバージョンチェックを行えません。\nインターネット接続を確認してください。");
		}
		return;
	}

	const updateBtn = document.getElementById('btn-manual-check-update');
	const statusEl = document.getElementById('version-check-status');
	let origBtnText = "";

	if (isManual && updateBtn) {
		origBtnText = updateBtn.textContent;
		updateBtn.disabled = true;
		updateBtn.textContent = '確認中...';
		if (statusEl) statusEl.textContent = '最新バージョンを確認しています...';
	}

	try {
		const res = await fetch('./version.json?_t=' + Date.now(), { cache: 'no-store' });
		if (!res.ok) {
			throw new Error('HTTP ' + res.status);
		}
		const data = await res.json();
		const remoteVersion = data && data.version ? data.version : null;

		if (remoteVersion && isNewerVersion(remoteVersion, CURRENT_APP_VERSION)) {
			if (statusEl) {
				statusEl.textContent = `新しいバージョン（v${remoteVersion}）が利用可能です。`;
			}
			const ok = confirm(`新しいバージョン（v${remoteVersion}）が公開されています。\n（現在のバージョン: v${CURRENT_APP_VERSION}）\n\n最新バージョンに更新しますか？\n※現在の作業内容は自動的にローカル保存されます。`);
			if (ok) {
				const doUpdate = (typeof module !== 'undefined' && module.exports && module.exports.performAppUpdate)
					? module.exports.performAppUpdate
					: performAppUpdate;
				await doUpdate();
			} else if (isManual && statusEl) {
				statusEl.textContent = '更新がキャンセルされました。';
			}
		} else {
			if (isManual) {
				alert(`お使いのアプリは最新バージョン（v${CURRENT_APP_VERSION}）です。`);
				if (statusEl) statusEl.textContent = '最新バージョンです。';
			}
		}
	} catch (err) {
		console.warn("Version check failed:", err);
		if (isManual) {
			alert("バージョン情報の取得に失敗しました。\nネットワーク接続を確認してください。");
			if (statusEl) statusEl.textContent = '更新確認に失敗しました。';
		}
	} finally {
		if (isManual && updateBtn) {
			updateBtn.disabled = false;
			updateBtn.textContent = origBtnText;
		}
	}
}

/**
 * 現在の作業状態を保存し、キャッシュを全消去して最新リソースを強制リロードします
 */
async function performAppUpdate() {
	// A-3: 防御的マルチモード状態保存（独立try-catch）
	const saveDistFn = (typeof global !== 'undefined' && global.saveDistrictLocal) || (typeof saveDistrictLocal === 'function' ? saveDistrictLocal : null);
	if (typeof saveDistFn === 'function') {
		try {
			saveDistFn();
		} catch (e) {
			console.warn("Failed to auto-save district before update:", e);
		}
	}

	const saveRepFn = (typeof global !== 'undefined' && global.saveRepLocal) || (typeof saveRepLocal === 'function' ? saveRepLocal : null);
	if (typeof saveRepFn === 'function') {
		try {
			saveRepFn();
		} catch (e) {
			console.warn("Failed to auto-save rep before update:", e);
		}
	}

	const saveNeighborFn = (typeof global !== 'undefined' && global.saveNeighborLocal) || (typeof saveNeighborLocal === 'function' ? saveNeighborLocal : null);
	if (typeof saveNeighborFn === 'function') {
		try {
			saveNeighborFn();
		} catch (e) {
			console.warn("Failed to auto-save neighbor before update:", e);
		}
	}

	const saveTransferFn = (typeof global !== 'undefined' && global.saveTransferLocal) || (typeof saveTransferLocal === 'function' ? saveTransferLocal : null);
	if (typeof saveTransferFn === 'function') {
		try {
			saveTransferFn();
		} catch (e) {
			console.warn("Failed to auto-save transfer before update:", e);
		}
	}

	// A-2: Cache Storageの完全破棄
	if (typeof caches !== 'undefined' && caches.keys) {
		try {
			const keys = await caches.keys();
			await Promise.all(keys.map(k => caches.delete(k)));
		} catch (e) {
			console.warn("Failed to clear caches:", e);
		}
	}

	// A-2: Service Worker登録の全解除
	if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
		try {
			const registrations = await navigator.serviceWorker.getRegistrations();
			await Promise.all(registrations.map(r => r.unregister()));
		} catch (e) {
			console.warn("Failed to unregister service workers:", e);
		}
	}

	// A-2: キャッシュバイパスクエリパラメータ付加による最新版ナビゲーション
	if (typeof window !== 'undefined' && window.location) {
		const origin = window.location.origin || '';
		const pathname = window.location.pathname || '';
		const newUrl = origin + pathname + '?_update=' + Date.now();
		if (typeof window.location.replace === 'function') {
			window.location.replace(newUrl);
		} else {
			window.location.href = newUrl;
		}
	}
}

/* =========================================================================
   DOM 初期化
========================================================================= */

window.addEventListener('beforeinstallprompt', (e) => {
	e.preventDefault();
	deferredInstallPrompt = e;
	const installBtn = document.getElementById('pwa-install-btn');
	if (installBtn) installBtn.style.display = 'inline-flex';
});

window.addEventListener('DOMContentLoaded', async () => {
	// ServiceWorker 登録（PWA対応）
	if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
		navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(err => {
			console.log('ServiceWorker registration error:', err);
		});
	}

	initAutoLockListeners();

	// ストレージ暗号化チェック
	if (isStorageEncrypted()) {
		updateSecurityBadge('locked');
		showStorageUnlockModal();
		// 生体認証が登録されている場合、スムーズな解除を試行
		const meta = getStorageAuthMeta();
		if (meta && meta.webauthn && isWebAuthnAvailable()) {
			setTimeout(() => {
				handleWebAuthnUnlock(true);
			}, 300);
		}
	} else {
		updateSecurityBadge('unencrypted');
		await loadAppDataFromStorage();
		renderDistrictForm();
		renderRepAll();
		if (typeof renderNeighborForm === 'function') renderNeighborForm();
		if (typeof loadTransferLocal === 'function') await loadTransferLocal();
		if (typeof renderTransferForm === 'function') renderTransferForm();
		setAllCardsCollapse(true, 'tab-district');
		setAllCardsCollapse(true, 'tab-rep');
		setAllCardsCollapse(true, 'tab-neighbor');
		setAllCardsCollapse(true, 'tab-transfer');
		resetAutoLockTimer();
	}

	// 直前選択モードの自動復元（A-3）
	restoreActiveMode();

	// 起動時オンライン自動バージョンチェック（1秒遅延して初期描画完了後に実行）
	if (typeof navigator !== 'undefined' && navigator.onLine) {
		setTimeout(() => {
			checkAppVersion(false);
		}, 1000);
	}
});

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		CURRENT_APP_VERSION,
		switchTab,
		restoreActiveMode,
		toggleModeSelector,
		shareAppUrl,
		triggerPwaInstall,
		updateSecurityBadge,
		showStorageUnlockModal,
		hideStorageUnlockModal,
		handleWebAuthnUnlock,
		handlePasswordUnlock,
		handleResetStorageConfirm,
		openStorageSettingsModal,
		closeStorageSettingsModal,
		validateModalPasswords,
		handleEnableEncryptionSubmit,
		handleAddOrUpdateBiometric,
		handleImmediateLock,
		clearMemoryAndDomForLock,
		resetAutoLockTimer,
		initAutoLockListeners,
		quickSetupEncryptionFromCard,
		loadAppDataFromStorage,
		checkAppVersion,
		performAppUpdate
	};
	Object.assign(global, module.exports);
}
