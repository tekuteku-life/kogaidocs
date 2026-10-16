/* =========================================================================
   ハタフロット連携機能
========================================================================= */

/**
 * 児童データと設定フォーマットに基づいてハタフロット変換プレビューを更新します
 */
function updateHataPreview() {
	const fmtEl = document.getElementById('hata-format');
	const dedupEl = document.getElementById('hata-dedup');
	const previewEl = document.getElementById('hata-preview');
	if (!fmtEl || !dedupEl || !previewEl) return;

	const fmt = fmtEl.value;
	const dedup = dedupEl.checked;
	const seen = new Set();
	const lines = [];

	currentDistrict.students.forEach(s => {
		if (!s.lastName && !s.firstName && !s.name && !s.address) return;
		normalizeNameFields(s);

		const lastName = (s.lastName || "").trim();
		const firstName = (s.firstName || "").trim();
		const fullName = getFullName(s);
		const lastKana = (s.lastNameKana || "").trim();
		const firstKana = (s.firstNameKana || "").trim();
		const fullKana = getFullNameKana(s);

		const rawAddr = (s.address || "").trim();
		// 全角数字（０-９）を半角数字（0-9）に正規化
		const normalizedAddr = rawAddr.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
		const numMatches = normalizedAddr.match(/\d+/g);
		const numAddr = numMatches ? numMatches.join('-') : rawAddr;

		const defaultHan = (currentDistrict.han || "").trim();
		const sHan = (s.han || "").trim();
		const han = sHan || defaultHan;
		const district = (currentDistrict.district || "").trim();

		const line = fmt
			.replace(/\{住所\}/g, rawAddr)
			.replace(/\{住所数字\}/g, numAddr)
			.replace(/\{地区\}/g, district)
			.replace(/\{班\}/g, han)
			.replace(/\{班名\}/g, han)
			.replace(/\{苗字\}/g, lastName)
			.replace(/\{名前\}/g, firstName)
			.replace(/\{氏名\}/g, fullName)
			.replace(/\{ふりがな\}/g, fullKana)
			.replace(/\{苗字ふりがな\}/g, lastKana)
			.replace(/\{名前ふりがな\}/g, firstKana)
			.replace(/\{学年\}/g, (s.grade || "") + "年")
			.trim();

		if (dedup) {
			const key = `${numAddr}_${lastName || fullName}`;
			if (seen.has(key)) return;
			seen.add(key);
		}
		if (line) lines.push(line);
	});

	previewEl.value = lines.join('\n');
}

/**
 * プレビューに表示されたハタフロット用リストをクリップボードにコピーします
 */
function copyHataList() {
	const text = document.getElementById('hata-preview').value;
	navigator.clipboard.writeText(text).then(() => alert("ハタフロット用リストをクリップボードにコピーしました。"));
}
