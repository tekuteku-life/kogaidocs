/* =========================================================================
	テスト用データフィクスチャ（District / Rep / Student / Officer）
========================================================================= */

function createMockDistrict(override = {}) {
	return {
		district: "1丁目",
		han: "1班",
		hanList: ["1班", "2班", "3班"],
		officers: [
			{
				lastName: "山田",
				firstName: "花子",
				lastNameKana: "やまだ",
				firstNameKana: "はなこ",
				role: "代表",
				han: "1班",
				tel: "090-1111-2222",
				email: "yamada@example.com",
				address: "1丁目1-1",
				childGrade: "6",
				childClass: "1",
				childLastName: "山田",
				childFirstName: "太郎",
				childLastNameKana: "やまだ",
				childFirstNameKana: "たろう",
				name: "山田 花子",
				childName: "山田 太郎"
			},
			{
				lastName: "佐藤",
				firstName: "恵子",
				lastNameKana: "さとう",
				firstNameKana: "けいこ",
				role: "校外委員",
				han: "2班",
				tel: "090-3333-4444",
				email: "sato@example.com",
				address: "1丁目2-3",
				childGrade: "4",
				childClass: "2",
				childLastName: "佐藤",
				childFirstName: "次郎",
				childLastNameKana: "さとう",
				childFirstNameKana: "じろう",
				name: "佐藤 恵子",
				childName: "佐藤 次郎"
			}
		],
		neighborhood: [
			{
				role: "自治会長",
				lastName: "中村",
				firstName: "吉右衛門",
				lastNameKana: "なかむら",
				firstNameKana: "きちえもん",
				name: "中村 吉右衛門",
				address: "1丁目5-1",
				tel: "03-1234-5678"
			},
			{
				role: "防犯部長",
				lastName: "小林",
				firstName: "一夫",
				lastNameKana: "こばやし",
				firstNameKana: "かずお",
				name: "小林 一夫",
				address: "1丁目7-2",
				tel: "03-9876-5432"
			}
		],
		szNeighborChecks: { 0: true, 1: true },
		students: [
			{
				grade: "6",
				class: "1",
				han: "1班",
				lastName: "山田",
				firstName: "太郎",
				lastNameKana: "やまだ",
				firstNameKana: "たろう",
				address: "1丁目1-1",
				tel: "090-1111-2222",
				leader: "班長",
				isOutOfDistrict: false
			},
			{
				grade: "5",
				class: "2",
				han: "1班",
				lastName: "木村",
				firstName: "拓也",
				lastNameKana: "きむら",
				firstNameKana: "たくや",
				address: "1丁目1-2",
				tel: "090-5555-6666",
				leader: "副班長",
				isOutOfDistrict: false
			},
			{
				grade: "4",
				class: "1",
				han: "2班",
				lastName: "佐藤",
				firstName: "次郎",
				lastNameKana: "さとう",
				firstNameKana: "じろう",
				address: "1丁目2-3",
				tel: "090-3333-4444",
				leader: "班長",
				isOutOfDistrict: false
			},
			{
				grade: "2",
				class: "3",
				han: "2班",
				lastName: "高橋",
				firstName: "三郎",
				lastNameKana: "たかはし",
				firstNameKana: "さぶろう",
				address: "1丁目4-5",
				tel: "090-7777-8888",
				leader: "",
				isOutOfDistrict: true
			}
		],
		...override
	};
}

function createMockRepState(override = {}) {
	const d1 = createMockDistrict({ district: "緑が丘", han: "A班", selectedForPrint: true });
	const d2 = createMockDistrict({
		district: "緑が丘",
		han: "B班",
		selectedForPrint: true,
		officers: [
			{
				lastName: "渡辺",
				firstName: "美穂",
				role: "校外委員",
				han: "B班",
				name: "渡辺 美穂"
			}
		],
		students: [
			{
				grade: "3",
				class: "1",
				han: "B班",
				lastName: "渡辺",
				firstName: "翔太",
				address: "緑が丘2-2",
				leader: "班長",
				isOutOfDistrict: false
			}
		]
	});
	const d3 = createMockDistrict({ district: "青葉台", han: "1班", selectedForPrint: false });

	return {
		districts: [d1, d2, d3],
		szExternals: [
			{ attend: true, category: "学校関係者", org: "小学校", role: "校長", lastName: "校長", firstName: "太郎", name: "校長 太郎", contact: "内線101" },
			{ attend: true, category: "学校関係者", org: "小学校", role: "副校長", lastName: "教頭", firstName: "次郎", name: "教頭 次郎", contact: "内線102" },
			{ attend: true, category: "PTA本部", org: "PTA本部", role: "会長", lastName: "本部", firstName: "会長", name: "本部 会長", contact: "pta@example.com" },
			{ attend: true, category: "役所・警察・関係機関", org: "区役所 地域振興課", role: "担当係長", lastName: "役所", firstName: "三郎", name: "役所 三郎", contact: "03-0000-1111" },
			{ attend: false, category: "役所・警察・関係機関", org: "警察署 交通課", role: "課長", lastName: "警察", firstName: "四郎", name: "警察 四郎", contact: "03-0000-2222" }
		],
		seatConfig: {
			cols: 4,
			rows: 5,
			leftSide: "窓側",
			rightSide: "廊下側",
			topLabel: "前方（演台・司会・スクリーン側）",
			bottomLabel: "後方（出入口側）",
			cells: {
				"0_0": { refKey: "FAC_STAGE", customText: "" },
				"0_1": { refKey: "EXT_0", customText: "" },
				"0_2": { refKey: "EXT_1", customText: "" },
				"1_0": { refKey: "OFF_0_0", customText: "代表校外委員" },
				"1_1": { refKey: "NEI_緑が丘_0", customText: "" },
				"2_0": { refKey: "CUSTOM", customText: "来賓特別席" }
			}
		},
		...override
	};
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		createMockDistrict,
		createMockRepState
	};
}
