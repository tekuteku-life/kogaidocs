/* =========================================================================
   共通ユーティリティ関数
========================================================================= */

/**
 * 特殊文字をHTMLエンティティにエスケープします
 * @param {string|number} str
 * @returns {string}
 */
function esc(str) {
	if (str === undefined || str === null) return "";
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * オブジェクトから姓名を結合したフルネームを取得します（後方互換対応）
 * @param {Object} item
 * @returns {string}
 */
function getFullName(item) {
	if (!item) return "";
	if (item.lastName || item.firstName) {
		return `${item.lastName || ""}${item.lastName && item.firstName ? " " : ""}${item.firstName || ""}`.trim();
	}
	return (item.name || "").trim();
}

/**
 * オブジェクトから姓名ふりがなを結合した文字列を取得します
 * @param {Object} item
 * @returns {string}
 */
function getFullNameKana(item) {
	if (!item) return "";
	if (item.lastNameKana || item.firstNameKana) {
		return `${item.lastNameKana || ""}${item.lastNameKana && item.firstNameKana ? " " : ""}${item.firstNameKana || ""}`.trim();
	}
	return (item.kana || "").trim();
}

/**
 * 役員のお子様の姓名を結合したフルネームを取得します
 * @param {Object} officer
 * @returns {string}
 */
function getChildFullName(officer) {
	if (!officer) return "";
	if (officer.childLastName || officer.childFirstName) {
		return `${officer.childLastName || ""}${officer.childLastName && officer.childFirstName ? " " : ""}${officer.childFirstName || ""}`.trim();
	}
	return (officer.childName || "").trim();
}

/**
 * 役員のお子様のふりがなを結合した文字列を取得します
 * @param {Object} officer
 * @returns {string}
 */
function getChildFullNameKana(officer) {
	if (!officer) return "";
	if (officer.childLastNameKana || officer.childFirstNameKana) {
		return `${officer.childLastNameKana || ""}${officer.childLastNameKana && officer.childFirstNameKana ? " " : ""}${officer.childFirstNameKana || ""}`.trim();
	}
	return (officer.childKana || "").trim();
}

/**
 * 旧形式の name プロパティを持つデータを lastName / firstName に補完・正規化します
 * @param {Object} item
 */
function normalizeNameFields(item) {
	if (!item) return;
	if (item.lastName === undefined) {
		if (item.name) {
			const parts = item.name.trim().split(/[\s　]+/);
			item.lastName = parts[0] || "";
			item.firstName = parts.slice(1).join(" ") || "";
		} else {
			item.lastName = "";
			item.firstName = "";
		}
	}
	if (item.firstName === undefined) item.firstName = "";
	if (item.lastNameKana === undefined) item.lastNameKana = "";
	if (item.firstNameKana === undefined) item.firstNameKana = "";
}

/**
 * 旧形式の childName を持つ役員データを childLastName / childFirstName に補完・正規化します
 * @param {Object} officer
 */
function normalizeOfficerChildNames(officer) {
	if (!officer) return;
	if (officer.address === undefined) officer.address = "";
	if (officer.ban === undefined) officer.ban = "";
	if (officer.childLastName === undefined) {
		if (officer.childName) {
			const parts = officer.childName.trim().split(/[\s　]+/);
			officer.childLastName = parts[0] || "";
			officer.childFirstName = parts.slice(1).join(" ") || "";
		} else {
			officer.childLastName = "";
			officer.childFirstName = "";
		}
	}
	if (officer.childFirstName === undefined) officer.childFirstName = "";
	if (officer.childLastNameKana === undefined) officer.childLastNameKana = "";
	if (officer.childFirstNameKana === undefined) officer.childFirstNameKana = "";
}

/**
 * 児童一覧から学年別の人数を集計します（学区外児童数もカウント）
 * @param {Array} students
 * @returns {Object}
 */
function getGradeCounts(students) {
	const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, total: 0, outOfDistrict: 0 };
	(students || []).forEach(s => {
		if (!s.lastName && !s.firstName && !s.name && !s.address) return;
		const g = parseInt(s.grade, 10);
		if (counts[g] !== undefined) { counts[g]++; counts.total++; }
		if (s.isOutOfDistrict) { counts.outOfDistrict++; }
	});
	return counts;
}

/**
 * 学年別集計結果を表示用文字列にフォーマットします
 * @param {Object} c
 * @returns {string}
 */
function formatGradeCounts(c) {
	const outStr = c.outOfDistrict ? `（うち学区外: ${c.outOfDistrict}名）` : "";
	return `6年：${c[6]}名 ／ 5年：${c[5]}名 ／ 4年：${c[4]}名 ／ 3年：${c[3]}名 ／ 2年：${c[2]}名 ／ 1年：${c[1]}名  【合計：${c.total}名${outStr}】`;
}

/**
 * テキストデータをBlob化してファイルダウンロードを実行します
 * @param {string} content
 * @param {string} filename
 */
function downloadTextFile(content, filename) {
	const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	a.click();
}

/**
 * パスワードの強度・文字種バリデーション
 * （最低12文字強制、半角英数大文字・小文字・記号のみ使用可能）
 * @param {string} password
 * @returns {{ valid: boolean, message: string }}
 */
function validatePassword(password) {
	if (!password || password.trim() === "") {
		return {
			valid: false,
			message: "パスワードが入力されていません。\n安全なデータ保存のため、パスワードの入力が必須です。"
		};
	}
	if (password.length < 12) {
		return {
			valid: false,
			message: `パスワードは最低12文字以上必要です。（現在: ${password.length}文字）`
		};
	}
	// 半角英数記号（ASCII印字可能文字 0x21-0x7E）のみ許可
	const asciiPrintableRegex = /^[\x21-\x7E]+$/;
	if (!asciiPrintableRegex.test(password)) {
		return {
			valid: false,
			message: "パスワードに使用できるのは半角英数字（大文字・小文字）と半角記号のみです。\n※スペースや全角文字、日本語は使用できません。"
		};
	}
	return { valid: true, message: "" };
}

/**
 * パスワード入力フィールドの表示・非表示を切り替えます
 * @param {string} inputId
 * @param {HTMLElement} btnEl
 */
function togglePasswordVisibility(inputId, btnEl) {
	const input = document.getElementById(inputId);
	if (!input) return;
	if (input.type === "password") {
		input.type = "text";
		if (btnEl) btnEl.textContent = "🙈";
	} else {
		input.type = "password";
		if (btnEl) btnEl.textContent = "👁️";
	}
}

/**
 * 児童名簿の並び順比較関数
 * 優先順位:
 * 1. 役職: 班長 → 副班長 → その他
 * 2. 学年（降順: 6年 → 1年）
 * 3. 住所（昇順・自然数値順）
 * 4. クラス・氏名ふりがな（同住所・同学年のタイブレーク）
 * @param {Object} a
 * @param {Object} b
 * @returns {number}
 */
function compareStudents(a, b) {
	// 0. 班名（異なる班名の場合は班の自然順でグループ化）
	const banA = String(a.ban || "").trim();
	const banB = String(b.ban || "").trim();
	if (banA !== banB) {
		const bDiff = banA.localeCompare(banB, 'ja', { numeric: true });
		if (bDiff !== 0) return bDiff;
	}

	// 1. 先頭に班長 → 副班長 → その他
	const getRoleRank = (leader) => {
		if (leader === "班長" || leader === "リーダー") return 1;
		if (leader === "副班長" || leader === "サブリーダー") return 2;
		return 3;
	};
	const roleDiff = getRoleRank(a.leader) - getRoleRank(b.leader);
	if (roleDiff !== 0) return roleDiff;

	// 2. 学年（降順: 6年 → 1年）
	const gDiff = (parseInt(b.grade, 10) || 0) - (parseInt(a.grade, 10) || 0);
	if (gDiff !== 0) return gDiff;

	// 3. 住所（昇順・自然数値順）
	if (a.address && !b.address) return -1;
	if (!a.address && b.address) return 1;
	if (a.address && b.address) {
		const addrDiff = String(a.address).localeCompare(String(b.address), 'ja', { numeric: true });
		if (addrDiff !== 0) return addrDiff;
	}

	// 4. クラス（昇順）
	if (a.class && !b.class) return -1;
	if (!a.class && b.class) return 1;
	if (a.class && b.class) {
		const cDiff = String(a.class).localeCompare(String(b.class), 'ja', { numeric: true });
		if (cDiff !== 0) return cDiff;
	}

	// 5. ふりがな（昇順）
	const aKana = getFullNameKana(a) || getFullName(a);
	const bKana = getFullNameKana(b) || getFullName(b);
	return aKana.localeCompare(bKana, 'ja');
}
