/* =========================================================================
   アプリケーション初期化・タブ切替・PWA・セキュリティUI
========================================================================= */

let deferredInstallPrompt = null;

function switchTab(mode) {
	const tabD = document.getElementById('tab-district');
	const tabR = document.getElementById('tab-rep');
	if (tabD) tabD.style.display = mode === 'district' ? 'block' : 'none';
	if (tabR) tabR.style.display = mode === 'rep' ? 'block' : 'none';
	const btns = document.querySelectorAll('.tab-btn');
	if (btns.length >= 2) {
		btns[0].classList.toggle('active', mode === 'district');
		btns[1].classList.toggle('active', mode === 'rep');
	}
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
		setAllCardsCollapse(true, 'tab-district');
		setAllCardsCollapse(true, 'tab-rep');
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
		setAllCardsCollapse(true, 'tab-district');
		setAllCardsCollapse(true, 'tab-rep');
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
					<input type="password" id="modal-set-pass" placeholder="半角英数記号12文字以上" oninput="validateModalPasswords()">
					<button type="button" class="btn-toggle-pass" onclick="togglePasswordVisibility('modal-set-pass', this)" title="表示/非表示">👁️</button>
				</div>
			</div>
			<div class="form-group" style="margin-bottom:12px;">
				<label>確認用パスワード（二度入力）</label>
				<div class="pass-input-group">
					<input type="password" id="modal-set-pass-confirm" placeholder="もう一度入力" oninput="validateModalPasswords()">
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
 * 今すぐストレージをロックします
 */
function handleImmediateLock() {
	lockStorage();
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
	const password = pEl ? pEl.value : "";
	const v = validatePassword(password);
	if (!v.valid) {
		alert(v.message);
		return;
	}

	const bioAvailable = isWebAuthnAvailable();
	let enableBio = false;
	if (bioAvailable) {
		enableBio = confirm("生体認証（Touch ID / Windows Hello / 指紋認証等）も合わせて登録しますか？\n（[OK]を押すと指紋または顔認証の登録画面が開きます）");
	}

	try {
		const result = await setupStorageEncryption(password, enableBio);
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
	currentDistrict.officers.forEach(off => {
		normalizeOfficerChildNames(off);
		normalizeNameFields(off);
	});
	currentDistrict.officer = currentDistrict.officers[0];

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
			d.officers.forEach(off => {
				normalizeOfficerChildNames(off);
				normalizeNameFields(off);
			});
			d.officer = d.officers[0];
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
		navigator.serviceWorker.register('./sw.js').catch(err => {
			console.log('ServiceWorker registration error:', err);
		});
	}

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
		setAllCardsCollapse(true, 'tab-district');
		setAllCardsCollapse(true, 'tab-rep');
	}
});
