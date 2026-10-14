const STORAGE_KEY = 'calcloan.areaAdjustment.v1';
const DATA_VERSION = 1;
const CATEGORIES = ['main', 'accessory', 'shared', 'land'];
const HOUSE_CATEGORIES = CATEGORIES.slice(0, 3);
const MAX_AREA = 100000;
const MAX_MONEY = 10000000000;
const SQM_PER_PING = 3.305785123966942;
const CONTRACT_SQM_INPUT_IDS = [
    'contract-total-area-sqm',
    'exclusive-area-sqm',
    'clause-main-area-sqm',
    'clause-accessory-area-sqm',
    'balcony-area-sqm',
    'rain-cover-area-sqm',
    'clause-shared-area-sqm'
];
// 契約欄位顯示至小數點後 2 位，各分項相加可能產生 0.01 的四捨五入尾差。
// 此容許值只用於組成一致性提示，不影響找補金額與 3% 門檻計算。
const AREA_ROUNDING_TOLERANCE = 0.010001;
const RATIO_ROUNDING_TOLERANCE = 0.010001;

const moneyFormatter = new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0
});

const decimalFormatter = new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 4
});

const tenThousandsFormatter = new Intl.NumberFormat('zh-TW', {
    maximumFractionDigits: 2
});

export function parseOptionalNumber(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    if (normalized === '') return null;
    const number = Number(normalized.replace(',', '.'));
    return Number.isFinite(number) ? number : null;
}

export function tenThousandsToTwd(value) {
    const amount = parseOptionalNumber(value);
    return Number.isFinite(amount) ? Math.round(amount * 10000) : null;
}

export function twdToTenThousands(value) {
    return Number.isFinite(value) ? value / 10000 : null;
}

export function convertArea(value, fromUnit) {
    if (!Number.isFinite(value)) return null;
    return fromUnit === 'sqm' ? value / SQM_PER_PING : value * SQM_PER_PING;
}

export function restoreAreaPairValues(pingValue, squareMetresValue) {
    const ping = Number.isFinite(pingValue)
        ? pingValue
        : Number.isFinite(squareMetresValue) ? convertArea(squareMetresValue, 'sqm') : null;
    const squareMetres = Number.isFinite(squareMetresValue)
        ? squareMetresValue
        : Number.isFinite(pingValue) ? convertArea(pingValue, 'ping') : null;
    return { ping, squareMetres };
}

function formatAreaInput(value) {
    return Number.isFinite(value) ? String(Number(value.toFixed(8))) : '';
}

export function calculateCategory({ contractArea, actualArea, price }, differenceOverride = null) {
    const hasAreas = Number.isFinite(contractArea) && contractArea > 0 && Number.isFinite(actualArea) && actualArea >= 0;
    const difference = Number.isFinite(differenceOverride)
        ? differenceOverride
        : hasAreas ? actualArea - contractArea : null;
    const rate = hasAreas ? difference / contractArea * 100 : null;
    const unitPrice = Number.isFinite(price) && price >= 0 && Number.isFinite(contractArea) && contractArea > 0
        ? price / contractArea
        : null;
    const amount = Number.isFinite(difference) && Number.isFinite(unitPrice)
        ? Math.round(difference * unitPrice)
        : null;
    return { difference, rate, unitPrice, amount };
}

export function calculateTotals(categories, scenarioDifferences = null, contractTotalOverride = null, actualTotalOverride = null, calculationCategories = categories) {
    const results = {};
    CATEGORIES.forEach((category) => {
        results[category] = calculateCategory(
            calculationCategories[category],
            scenarioDifferences && Object.hasOwn(scenarioDifferences, category) ? scenarioDifferences[category] : null
        );
    });

    const contractBreakdownComplete = HOUSE_CATEGORIES.every((category) => (
        Number.isFinite(categories[category].contractArea) && categories[category].contractArea > 0
    ));
    const actualBreakdownComplete = HOUSE_CATEGORIES.every((category) => (
        Number.isFinite(categories[category].actualArea) && categories[category].actualArea >= 0
    ));
    const calculatedContractTotal = contractBreakdownComplete
        ? HOUSE_CATEGORIES.reduce((sum, category) => sum + categories[category].contractArea, 0)
        : null;
    const contractTotal = Number.isFinite(contractTotalOverride) && contractTotalOverride > 0
        ? contractTotalOverride : calculatedContractTotal;
    const calculatedActualTotal = actualBreakdownComplete
        ? HOUSE_CATEGORIES.reduce((sum, category) => sum + categories[category].actualArea, 0)
        : null;
    const actualTotal = Number.isFinite(actualTotalOverride) && actualTotalOverride >= 0
        ? actualTotalOverride : calculatedActualTotal;
    const houseAreasComplete = Number.isFinite(contractTotal) && Number.isFinite(actualTotal);
    const totalDifference = scenarioDifferences
        ? HOUSE_CATEGORIES.reduce((sum, category) => sum + scenarioDifferences[category], 0)
        : houseAreasComplete ? actualTotal - contractTotal : null;
    const totalRate = houseAreasComplete ? totalDifference / contractTotal * 100 : null;
    const amountValues = HOUSE_CATEGORIES.map((category) => results[category].amount);
    const partialReferenceNet = amountValues.some(Number.isFinite)
        ? amountValues.filter(Number.isFinite).reduce((sum, amount) => sum + amount, 0)
        : null;
    const completedAmountCount = amountValues.filter(Number.isFinite).length;
    const referenceNet = completedAmountCount === HOUSE_CATEGORIES.length ? partialReferenceNet : null;

    return { results, houseAreasComplete, contractBreakdownComplete, actualBreakdownComplete, calculatedContractTotal, calculatedActualTotal, contractTotal, actualTotal, totalDifference, totalRate, partialReferenceNet, completedAmountCount, referenceNet };
}

export function prepareCompensableCategories(data) {
    const categories = Object.fromEntries(CATEGORIES.map((category) => [category, { ...data.categories[category] }]));
    const treatment = data.basic.rainCoverTreatment || 'pending';
    const contractRainCover = data.basic.rainCoverArea;
    const actualRainCover = data.basic.actualRainCoverArea;
    const accessory = categories.accessory;

    if (treatment === 'none') {
        return { categories, ready: true, message: '已確認無雨遮；附屬建物以輸入的契約與實際總面積計算。' };
    }
    if (treatment === 'excluded') {
        return { categories, ready: true, message: '已確認附屬建物總面積不含雨遮；不另行扣除。' };
    }
    if (treatment === 'included') {
        const areasKnown = Number.isFinite(accessory.contractArea) && accessory.contractArea > 0
            && Number.isFinite(accessory.actualArea) && accessory.actualArea >= 0
            && Number.isFinite(contractRainCover) && contractRainCover >= 0
            && Number.isFinite(actualRainCover) && actualRainCover >= 0;
        const areasValid = areasKnown
            && contractRainCover < accessory.contractArea
            && actualRainCover <= accessory.actualArea;
        const priceConfirmed = data.basic.accessoryPriceBasis === 'compensable';
        if (areasValid && priceConfirmed) {
            accessory.contractArea -= contractRainCover;
            accessory.actualArea -= actualRainCover;
            return {
                categories,
                ready: true,
                message: `附屬建物可找補面積：契約 ${formatAreaInput(accessory.contractArea)} 坪，實際 ${formatAreaInput(accessory.actualArea)} 坪；已依輸入雨遮面積各自扣除。`
            };
        }
        categories.accessory = { contractArea: null, actualArea: null, price: null };
        const missing = [];
        if (!areasKnown) missing.push('契約與實際雨遮面積');
        else if (!areasValid) missing.push('雨遮面積不得大於對應的附屬建物面積');
        if (!priceConfirmed) missing.push('附屬建物價款基準');
        return { categories, ready: false, message: `附屬建物暫不計價：請確認${missing.join('、')}。` };
    }

    categories.accessory = { contractArea: null, actualArea: null, price: null };
    return { categories, ready: false, message: '尚未確認雨遮是否包含於附屬建物總面積，附屬建物價差暫不計算。' };
}

export function calculateTwoPercentScenario(categories, results) {
    const complete = HOUSE_CATEGORIES.every((category) => {
        const source = categories[category];
        const result = results[category];
        return Number.isFinite(source.contractArea) && source.contractArea > 0
            && Number.isFinite(result.difference) && Number.isFinite(result.unitPrice);
    });
    if (!complete) return { amount: null, items: {} };

    const items = {};
    let amount = 0;
    HOUSE_CATEGORIES.forEach((category) => {
        const difference = results[category].difference;
        const assumedDifference = difference > 0
            ? Math.min(difference, categories[category].contractArea * 0.02)
            : difference;
        const assumedAmount = Math.round(assumedDifference * results[category].unitPrice);
        items[category] = { difference, assumedDifference, assumedAmount };
        amount += assumedAmount;
    });
    return { amount, items };
}

export function exceedsThreePercent(rate) {
    if (!Number.isFinite(rate)) return false;
    const floatingPointTolerance = Number.EPSILON * Math.max(Math.abs(rate), 3) * 16;
    return Math.abs(rate) - 3 > floatingPointTolerance;
}

export function assessInputState(data, totals) {
    const blockingErrors = [];
    const warnings = [];
    const info = [];
    const labels = { main: '主建物', accessory: '附屬建物', shared: '共有部分' };
    const add = (list, message) => { if (!list.includes(message)) list.push(message); };

    if (Number.isFinite(data.basic.totalPrice) && Number.isFinite(data.basic.parkingPrice)
        && data.basic.parkingPrice > data.basic.totalPrice) add(blockingErrors, '車位價款不可大於成交總價。');
    HOUSE_CATEGORIES.forEach((category) => {
        const row = data.categories[category];
        if (!Number.isFinite(row.contractArea) || row.contractArea <= 0) add(blockingErrors, `${labels[category]}契約面積須大於 0。`);
        if (!Number.isFinite(row.actualArea) || row.actualArea < 0) add(blockingErrors, `${labels[category]}實際登記面積不可空白或為負。`);
        if (!Number.isFinite(row.price) || row.price < 0) add(blockingErrors, `${labels[category]}契約分項價款不可空白或為負。`);
    });
    if (!Number.isFinite(data.basic.contractTotalArea) || data.basic.contractTotalArea <= 0) add(blockingErrors, '第四條契約房屋總面積須大於 0。');
    if (!Number.isFinite(data.basic.declaredTotalArea) || data.basic.declaredTotalArea < 0) add(blockingErrors, '實際登記房屋總面積不可空白或為負。');
    if (Number.isFinite(data.basic.contractTotalArea) && totals.contractBreakdownComplete) {
        const difference = totals.calculatedContractTotal - data.basic.contractTotalArea;
        if (Math.abs(difference) > AREA_ROUNDING_TOLERANCE) add(blockingErrors, `契約房屋總面積與三分項加總相差 ${formatArea(difference, true)}，超出合理四捨五入尾差。`);
        else info.push('契約房屋總面積與契約三分項加總一致（含合理尾差）。');
    }
    if (Number.isFinite(data.basic.declaredTotalArea) && totals.actualBreakdownComplete) {
        const difference = data.basic.declaredTotalArea - totals.calculatedActualTotal;
        if (Math.abs(difference) > AREA_ROUNDING_TOLERANCE) add(blockingErrors, `實際登記房屋總面積與三分項加總相差 ${formatArea(difference, true)}，超出合理四捨五入尾差。`);
        else info.push('實際登記房屋總面積與實際三分項加總一致（含合理尾差）。');
    }
    if (data.basic.parkingAreaScope !== 'excluded') {
        add(blockingErrors, data.basic.parkingAreaScope === 'included'
            ? '權狀總面積或共有部分含車位，與契約房屋面積比較範圍不一致；請改填不含車位的可比較數值。'
            : '車位面積是否計入權狀總面積或共有部分尚未釐清，房屋總面積不可比較。');
    } else info.push('已確認契約與實際登記面積採相同比較範圍，且不含車位。');
    if (Number.isFinite(data.basic.contractMainRatio) && Number.isFinite(data.basic.contractTotalArea)
        && data.basic.contractTotalArea > 0 && Number.isFinite(data.categories.main.contractArea)) {
        const calculated = data.categories.main.contractArea / data.basic.contractTotalArea * 100;
        if (Math.abs(calculated - data.basic.contractMainRatio) > RATIO_ROUNDING_TOLERANCE) warnings.push(`契約記載主建物比例為 ${data.basic.contractMainRatio}%，依面積換算為 ${calculated.toFixed(2)}%，請核對原始契約。`);
    }
    const areaPairs = [
        ['contract-total-area-sqm', data.basic.contractTotalArea, '契約房屋總面積'],
        ['exclusive-area-sqm', data.basic.exclusiveArea, '專有部分'],
        ['clause-main-area-sqm', data.categories.main.contractArea, '主建物'],
        ['clause-accessory-area-sqm', data.categories.accessory.contractArea, '附屬建物'],
        ['clause-shared-area-sqm', data.categories.shared.contractArea, '共有部分']
    ];
    areaPairs.forEach(([sqmId, ping, label]) => {
        const sqm = data.basic.squareMetres?.[sqmId];
        if (Number.isFinite(sqm) && Number.isFinite(ping) && Math.abs(convertArea(sqm, 'sqm') - ping) > AREA_ROUNDING_TOLERANCE) {
            warnings.push(`${label}的平方公尺與坪數換算不一致，已保留原始輸入，請核對契約記載值。`);
        }
    });
    return { blockingErrors, warnings, info };
}

function formatArea(value, signed = false) {
    if (!Number.isFinite(value)) return '—';
    const prefix = signed && value > 0 ? '+' : '';
    return `${prefix}${decimalFormatter.format(value)} 坪`;
}

function formatPercent(value) {
    if (!Number.isFinite(value)) return '—';
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${value.toFixed(2)}%`;
}

function formatMoney(value, signed = false) {
    if (!Number.isFinite(value)) return '—';
    const formattedNumber = moneyFormatter.format(Math.abs(Math.round(value))).replace(/^(?:NT)?\$\s?/, '');
    const absolute = `NT$ ${formattedNumber}`;
    if (!signed || value === 0) return absolute;
    return `${value > 0 ? '+' : '−'}${absolute}`;
}

function formatTenThousands(value) {
    if (!Number.isFinite(value)) return '—';
    return `${tenThousandsFormatter.format(value / 10000)} 萬元`;
}

export function buildBuilderInquiry(data, totals, capScenario, calculationCategories = data.categories) {
    const labels = { main: '主建物', accessory: '附屬建物（契約無雨遮）', shared: '共有部分' };
    const valueOrPending = (value, formatter) => Number.isFinite(value) ? formatter(value) : '尚未輸入';
    const categoryLines = HOUSE_CATEGORIES.map((category) => {
        const source = calculationCategories[category];
        const result = totals.results[category];
        return `${labels[category]}：契約 ${valueOrPending(source.contractArea, formatArea)}，實際登記 ${valueOrPending(source.actualArea, formatArea)}，差額 ${valueOrPending(result.difference, (value) => formatArea(value, true))}；契約分項價款 ${valueOrPending(source.price, formatTenThousands)}，單價 ${valueOrPending(result.unitPrice, formatMoney)}／坪，未調整價差 ${valueOrPending(result.amount, (value) => formatMoney(value, true))}。`;
    });
    const totalSummary = `契約房屋總面積 ${valueOrPending(totals.contractTotal, formatArea)}，實際登記總面積 ${valueOrPending(totals.actualTotal, formatArea)}，總面積差 ${valueOrPending(totals.totalDifference, (value) => formatArea(value, true))}，總面積誤差率 ${valueOrPending(totals.totalRate, formatPercent)}。`;
    const unadjusted = valueOrPending(totals.referenceNet, (value) => formatMoney(value, true));
    const capped = valueOrPending(capScenario.amount, (value) => formatMoney(value, true));

    return [
        '您好，我想依預售屋契約第六條核對房屋面積找補，以下是依契約與登記資料整理的數值：',
        ...categoryLines.map((line, index) => `${index + 1}. ${line}`),
        `4. 總面積：${totalSummary}`,
        `5. 三個房屋分項的未調整參考淨額為 ${unadjusted}；若假設每個增加分項各自最多計入契約面積 2%，不足面積全額計入，試算結果為 ${capped}。這只是情境試算，不是我認定的正式結算金額。`,
        '請提供貴公司正式面積找補計算明細，逐項列出主建物、附屬建物與共有部分採用的契約面積、登記面積、分項價款、每坪單價及價差；本契約無雨遮，另請說明車位面積與車位價款如何排除。',
        '另外請說明契約所載「買方找補以 2% 為限」實際套用在哪一項、計價面積如何決定，以及最後退款或補款淨額。謝謝。',
        '註：以上金額正數表示買方可能補款，負數表示建商可能退款；仍請以雙方確認的契約內容及正式結算明細為準。'
    ].join('\n\n');
}

function valueInRange(value, maximum, allowZero = true) {
    return value === null || (Number.isFinite(value) && value <= maximum && (allowZero ? value >= 0 : value > 0));
}

function makeEmptyCategories() {
    return Object.fromEntries(CATEGORIES.map((category) => [category, {
        contractArea: null,
        actualArea: null,
        price: null
    }]));
}

export function validateData(data) {
    if (!data || typeof data !== 'object' || data.version !== DATA_VERSION) return 'JSON 版本不符或缺少版本資訊。';
    if (!data.basic || typeof data.basic !== 'object' || !data.categories || typeof data.categories !== 'object') return 'JSON 結構不完整。';
    if ((data.basic.projectName !== undefined && typeof data.basic.projectName !== 'string')
        || (data.basic.unitName !== undefined && typeof data.basic.unitName !== 'string')
        || typeof data.basic.changeNotes !== 'string' || typeof data.basic.builderNotes !== 'string'
        || typeof data.basic.suspectedChange !== 'boolean'
        || !['refund', 'payment'].includes(data.basic.builderDirection)) return '基本資料型別無效。';
    for (const key of ['totalPrice', 'parkingPrice', 'parkingArea', 'landPrice', 'declaredTotalArea', 'builderAmount']) {
        const maximum = key.toLowerCase().includes('area') ? MAX_AREA : MAX_MONEY;
        if (!valueInRange(data.basic[key], maximum)) return `${key} 的數值無效。`;
    }
    for (const key of ['contractTotalArea', 'exclusiveArea', 'balconyArea', 'rainCoverArea', 'actualRainCoverArea']) {
        const allowZero = ['balconyArea', 'rainCoverArea', 'actualRainCoverArea'].includes(key);
        if (data.basic[key] !== undefined && !valueInRange(data.basic[key], MAX_AREA, allowZero)) return `${key} 的數值無效。`;
    }
    if (data.basic.rainCoverTreatment !== undefined && !['pending', 'included', 'excluded', 'none'].includes(data.basic.rainCoverTreatment)) return '雨遮面積處理格式無效。';
    if (data.basic.accessoryPriceBasis !== undefined && !['pending', 'compensable'].includes(data.basic.accessoryPriceBasis)) return '附屬建物價款基準格式無效。';
    if (data.basic.parkingAreaScope !== undefined && !['pending', 'excluded', 'included'].includes(data.basic.parkingAreaScope)) return 'parkingAreaScope 的格式無效。';
    if (data.basic.contractMainRatioSource !== undefined && !['auto', 'manual'].includes(data.basic.contractMainRatioSource)) return 'contractMainRatioSource 的格式無效。';
    if (data.basic.contractMainRatio !== undefined && !valueInRange(data.basic.contractMainRatio, 100)) return 'contractMainRatio 的數值無效。';
    if (data.basic.squareMetres !== undefined) {
        if (!data.basic.squareMetres || typeof data.basic.squareMetres !== 'object' || Array.isArray(data.basic.squareMetres)) {
            return '平方公尺資料格式無效。';
        }
        for (const id of CONTRACT_SQM_INPUT_IDS) {
            if (data.basic.squareMetres[id] !== undefined && !valueInRange(data.basic.squareMetres[id], MAX_AREA)) {
                return `${id} 的數值無效。`;
            }
        }
    }
    for (const category of CATEGORIES) {
        const row = data.categories[category];
        if (!row || !valueInRange(row.contractArea, MAX_AREA, false) || !valueInRange(row.actualArea, MAX_AREA) || !valueInRange(row.price, MAX_MONEY)) {
            return `${category} 的面積或價款無效。`;
        }
    }
    if (data.documents !== undefined && (!Array.isArray(data.documents) || data.documents.some((item) => typeof item !== 'string'))) return '舊版文件清單格式無效。';
    return '';
}

export function serializeAdjustmentData(data) {
    return JSON.stringify(data, null, 2);
}

export function deserializeAdjustmentData(text) {
    const data = JSON.parse(text);
    const validationError = validateData(data);
    if (validationError) throw new Error(validationError);
    return data;
}

if (typeof document !== 'undefined') {
    const form = document.querySelector('#adjustment-form');
    const rows = [...document.querySelectorAll('#area-rows tr[data-category]')];

    const element = (id) => document.getElementById(id);
    const readInput = (id) => parseOptionalNumber(element(id).value);
    const writeInput = (id, value) => { element(id).value = value ?? ''; };
    const readMoneyValue = tenThousandsToTwd;
    const readMoneyInput = (id) => readMoneyValue(element(id).value);
    const writeMoneyInput = (id, value) => {
        const amount = twdToTenThousands(value);
        element(id).value = Number.isFinite(amount) ? String(amount) : '';
    };

    function syncAreaPair(input) {
        const paired = element(input.dataset.areaPair);
        const value = parseOptionalNumber(input.value);
        if (!paired) return input;
        if (!Number.isFinite(value)) {
            paired.value = '';
            return input.dataset.areaUnit === 'ping' ? input : paired;
        }
        if (input.dataset.areaUnit === 'sqm') {
            paired.value = formatAreaInput(convertArea(value, 'sqm'));
            return paired;
        }
        paired.value = formatAreaInput(convertArea(value, 'ping'));
        return input;
    }

    function syncCategoryFromClause(pingInput) {
        const category = pingInput.dataset.categorySync;
        if (!category) return;
        const row = rows.find((item) => item.dataset.category === category);
        const value = parseOptionalNumber(pingInput.value);
        row.querySelector('[data-field="contractArea"]').value = Number.isFinite(value) ? String(value) : '';
    }

    function syncClauseFromCategory(tableInput) {
        const row = tableInput.closest('tr[data-category]');
        if (!row || tableInput.dataset.field !== 'contractArea') return;
        const clauseInput = document.querySelector(`[data-category-sync="${row.dataset.category}"]`);
        if (!clauseInput) return;
        clauseInput.value = tableInput.value;
        syncAreaPair(clauseInput);
    }

    function updateMainRatio() {
        const ratioInput = element('contract-main-ratio');
        if (ratioInput.dataset.valueSource === 'manual') return;
        const mainArea = readInput('clause-main-area');
        const totalArea = readInput('contract-total-area');
        ratioInput.value = Number.isFinite(mainArea) && Number.isFinite(totalArea) && totalArea > 0
            ? (mainArea / totalArea * 100).toFixed(2)
            : '';
        ratioInput.dataset.valueSource = 'auto';
    }

    function collectData() {
        const categories = makeEmptyCategories();
        rows.forEach((row) => {
            const category = row.dataset.category;
            ['contractArea', 'actualArea', 'price'].forEach((field) => {
                const value = row.querySelector(`[data-field="${field}"]`).value;
                categories[category][field] = field === 'price' ? readMoneyValue(value) : parseOptionalNumber(value);
            });
        });
        return {
            version: DATA_VERSION,
            savedAt: new Date().toISOString(),
            basic: {
                totalPrice: readMoneyInput('total-price'),
                parkingPrice: readMoneyInput('parking-price'),
                parkingArea: readInput('parking-area'),
                landPrice: readMoneyInput('land-price'),
                contractTotalArea: readInput('contract-total-area'),
                exclusiveArea: readInput('exclusive-area'),
                balconyArea: readInput('balcony-area'),
                rainCoverArea: readInput('rain-cover-area'),
                actualRainCoverArea: readInput('actual-rain-cover-area'),
                rainCoverTreatment: 'none',
                accessoryPriceBasis: 'compensable',
                contractMainRatio: readInput('contract-main-ratio'),
                contractMainRatioSource: element('contract-main-ratio').dataset.valueSource || 'auto',
                squareMetres: Object.fromEntries(CONTRACT_SQM_INPUT_IDS.map((id) => [id, readInput(id)])),
                declaredTotalArea: readInput('declared-total-area'),
                parkingAreaScope: element('parking-area-scope').value,
                suspectedChange: element('suspected-change').checked,
                changeNotes: element('change-notes').value,
                builderDirection: element('builder-direction').value,
                builderAmount: readInput('builder-amount'),
                builderNotes: element('builder-notes').value
            },
            categories
        };
    }

    function applyData(data) {
        const { basic } = data;
        ['parkingArea', 'actualRainCoverArea', 'contractMainRatio', 'declaredTotalArea'].forEach((key) => {
            const id = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
            writeInput(id, basic[key]);
        });
        ['totalPrice', 'parkingPrice', 'landPrice'].forEach((key) => {
            const id = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
            writeMoneyInput(id, basic[key]);
        });
        writeInput('builder-amount', basic.builderAmount);
        element('suspected-change').checked = Boolean(basic.suspectedChange);
        writeInput('rain-cover-area', 0);
        writeInput('rain-cover-area-sqm', 0);
        writeInput('actual-rain-cover-area', 0);
        element('rain-cover-treatment').value = 'none';
        element('accessory-price-basis').value = 'compensable';
        element('change-notes').value = basic.changeNotes || '';
        element('builder-direction').value = basic.builderDirection === 'payment' ? 'payment' : 'refund';
        element('builder-notes').value = basic.builderNotes || '';
        element('parking-area-scope').value = ['excluded', 'included'].includes(basic.parkingAreaScope) ? basic.parkingAreaScope : 'pending';
        element('contract-main-ratio').dataset.valueSource = basic.contractMainRatioSource === 'manual' ? 'manual' : 'auto';
        rows.forEach((row) => {
            const source = data.categories[row.dataset.category];
            ['contractArea', 'actualArea', 'price'].forEach((field) => {
                const input = row.querySelector(`[data-field="${field}"]`);
                input.value = field === 'price' && Number.isFinite(source[field]) ? String(source[field] / 10000) : source[field] ?? '';
            });
        });
        const storedSquareMetres = basic.squareMetres || {};
        const areaPairs = [
            ['contract-total-area', 'contract-total-area-sqm', basic.contractTotalArea],
            ['exclusive-area', 'exclusive-area-sqm', basic.exclusiveArea],
            ['clause-main-area', 'clause-main-area-sqm', data.categories.main.contractArea],
            ['clause-accessory-area', 'clause-accessory-area-sqm', data.categories.accessory.contractArea],
            ['balcony-area', 'balcony-area-sqm', basic.balconyArea],
            ['clause-shared-area', 'clause-shared-area-sqm', data.categories.shared.contractArea]
        ];
        areaPairs.forEach(([pingId, sqmId, pingValue]) => {
            const restored = restoreAreaPairValues(pingValue, storedSquareMetres[sqmId]);
            writeInput(pingId, restored.ping);
            writeInput(sqmId, restored.squareMetres);
        });
        if (!Number.isFinite(basic.contractMainRatio)) {
            element('contract-main-ratio').dataset.valueSource = 'auto';
            updateMainRatio();
        }
        render();
    }

    function validateInputs(data, totals) {
        document.querySelectorAll('.field-error').forEach((node) => { node.textContent = ''; });
        const result = assessInputState(data, totals);
        if (!valueInRange(data.basic.totalPrice, MAX_MONEY)) result.blockingErrors.push('成交總價必須是 0 以上的有效金額。');
        if (!valueInRange(data.basic.parkingPrice, MAX_MONEY)) result.blockingErrors.push('車位價款必須是 0 以上的有效金額。');
        if (Number.isFinite(data.basic.totalPrice) && Number.isFinite(data.basic.parkingPrice) && data.basic.parkingPrice > data.basic.totalPrice) {
            document.querySelector('[data-error-for="parking-price"]').textContent = '車位價款不可大於成交總價。';
        }
        for (const category of ['land']) {
            const values = data.categories[category];
            if (!valueInRange(values.contractArea, MAX_AREA, false)) result.blockingErrors.push(`${category} 契約面積須大於 0。`);
            if (!valueInRange(values.actualArea, MAX_AREA)) result.blockingErrors.push(`${category} 實際面積不可為負。`);
            if (!valueInRange(values.price, MAX_MONEY)) result.blockingErrors.push(`${category} 價款不可為負。`);
        }
        for (const [key, label] of [['exclusiveArea', '專有部分面積']]) {
            if (!valueInRange(data.basic[key], MAX_AREA, false)) result.blockingErrors.push(`${label}須大於 0。`);
        }
        for (const [key, label] of [['balconyArea', '陽臺面積'], ['rainCoverArea', '雨遮面積']]) {
            if (!valueInRange(data.basic[key], MAX_AREA)) result.blockingErrors.push(`${label}不可為負。`);
        }
        if (!valueInRange(data.basic.actualRainCoverArea, MAX_AREA)) result.blockingErrors.push('實際登記雨遮面積不可為負。');
        if (!valueInRange(data.basic.contractMainRatio, 100)) result.blockingErrors.push('主建物比例須介於 0% 至 100%。');
        result.blockingErrors = [...new Set(result.blockingErrors)];
        return result;
    }

    function setOutput(row, name, text, numericValue = null) {
        const output = row.querySelector(`[data-output="${name}"]`);
        output.textContent = text;
        output.classList.toggle('is-negative', Number.isFinite(numericValue) && numericValue < 0);
        output.classList.toggle('is-positive', Number.isFinite(numericValue) && numericValue > 0);
    }

    function buildWarnings(data, totals, allowThresholdConclusion = true) {
        const warnings = [];
        const mainRate = totals.results.main.rate;
        const totalRate = totals.totalRate;
        const comparableRates = [mainRate, totalRate].filter(Number.isFinite);
        if (comparableRates.some((rate) => rate < 0)) warnings.push(['success', '契約第六條：主建物或房屋登記總面積不足時，不足部分應全部找補；金額仍依房屋分項單價計算一次。']);
        if (comparableRates.some((rate) => rate > 0)) warnings.push(['', '契約第六條：主建物或登記總面積增加時，買方找補以 2% 為限；上限如何落實於分項結算仍須核對完整契約與適用規範。']);
        if (allowThresholdConclusion && comparableRates.some(exceedsThreePercent)) warnings.push(['alert', '依契約第六條第三項，可能符合買方解除契約條件，請進一步核對。']);
        if (!Number.isFinite(data.basic.contractTotalArea)) warnings.push(['', '第四條第一項已提供；請輸入契約記載的房屋總面積。目前總面積計算僅在分項齊全時採分項加總暫估。']);
        if (HOUSE_CATEGORIES.some((category) => !Number.isFinite(data.categories[category].price))) warnings.push(['', '分項價款未齊，不猜測單價；缺少價款的項目只顯示面積差與警示。']);
        if (!Number.isFinite(totals.results.accessory.amount) && Number.isFinite(data.categories.accessory.price)) warnings.push(['', '附屬建物雨遮排除資料未齊或未確認，不猜測雨遮為 0，也不輸出確定的附屬建物價差。']);
        if (data.basic.suspectedChange) warnings.push(['alert', '已標記疑似設計變更：請另行比對原始圖說、變更圖說與買方同意紀錄，不由面積差直接推論擅自變更。']);
        warnings.push(['', '完整未調整參考淨額是純算術分項價差加總；正式應退／應補金額仍為「待核對契約後確定」。']);
        return warnings;
    }

    function render() {
        const data = collectData();
        const compensable = prepareCompensableCategories(data);
        const totals = calculateTotals(data.categories, null, data.basic.contractTotalArea, data.basic.declaredTotalArea, compensable.categories);
        const validation = validateInputs(data, totals);
        const isBlocked = validation.blockingErrors.length > 0;

        const priceDifference = Number.isFinite(data.basic.totalPrice) && Number.isFinite(data.basic.parkingPrice)
            ? data.basic.totalPrice - data.basic.parkingPrice : null;
        element('price-excluding-parking').textContent = formatTenThousands(priceDifference);
        element('contract-rain-cover-display').value = Number.isFinite(data.basic.rainCoverArea) ? data.basic.rainCoverArea : '';
        element('rain-cover-status').textContent = compensable.message;
        element('area-error').textContent = validation.blockingErrors.join(' ');

        rows.forEach((row) => {
            const category = row.dataset.category;
            const result = totals.results[category];
            setOutput(row, 'difference', formatArea(result.difference, true), result.difference);
            if (category === 'land') {
                setOutput(row, 'rate', '不適用房屋公式');
                setOutput(row, 'unitPrice', '不適用房屋公式');
                setOutput(row, 'amount', '不計入房屋找補');
                return;
            }
            setOutput(row, 'rate', formatPercent(result.rate), result.rate);
            setOutput(row, 'unitPrice', formatMoney(result.unitPrice));
            setOutput(row, 'amount', formatMoney(result.amount, true), result.amount);
        });

        element('main-rate').textContent = isBlocked ? '資料待核對' : formatPercent(totals.results.main.rate);
        element('main-formula').textContent = Number.isFinite(totals.results.main.rate)
            ? `(${formatArea(data.categories.main.actualArea)} − ${formatArea(data.categories.main.contractArea)}) ÷ ${formatArea(data.categories.main.contractArea)}`
            : '（實際 − 契約）÷ 契約';
        element('total-difference').textContent = isBlocked ? '資料待核對' : formatArea(totals.totalDifference, true);
        element('total-rate').textContent = isBlocked ? '資料待核對' : formatPercent(totals.totalRate);
        element('partial-reference-net').textContent = formatMoney(totals.partialReferenceNet, true);
        element('partial-reference-note').textContent = isBlocked && totals.completedAmountCount > 0
            ? `部分資料參考值，尚未通過驗證；已計入 ${totals.completedAmountCount} / ${HOUSE_CATEGORIES.length} 個房屋分項`
            : totals.completedAmountCount > 0
            ? `已計入 ${totals.completedAmountCount} / ${HOUSE_CATEGORIES.length} 個房屋分項；不代表完整淨額`
            : '尚無可計算分項';
        element('reference-net').textContent = isBlocked ? '—' : formatMoney(totals.referenceNet, true);
        element('reference-net-note').textContent = isBlocked ? '資料有阻止性錯誤，完整淨額暫不顯示' : Number.isFinite(totals.referenceNet)
            ? '三個房屋分項齊全；尚未套用契約上限'
            : '三個房屋分項的面積與價款齊全後才顯示';

        const capScenario = calculateTwoPercentScenario(compensable.categories, totals.results);
        const scenarioComplete = !isBlocked && Number.isFinite(capScenario.amount) && Number.isFinite(totals.referenceNet);
        element('scenario-unadjusted').textContent = scenarioComplete ? formatMoney(totals.referenceNet, true) : '—';
        element('scenario-capped').textContent = scenarioComplete ? formatMoney(capScenario.amount, true) : '—';
        element('cap-scenario-status').textContent = scenarioComplete
            ? '假設試算／請依下方步驟核對'
            : isBlocked ? '資料待核對：暫不顯示情境淨額' : '資料未齊：先補齊三項面積與價款';
        const scenarioBars = element('scenario-bars');
        if (scenarioComplete) {
            const labels = { main: '主建物', accessory: '附屬建物', shared: '共有部分' };
            const maximum = Math.max(...HOUSE_CATEGORIES.map((category) => Math.abs(totals.results[category].amount)), 1);
            scenarioBars.innerHTML = HOUSE_CATEGORIES.map((category) => {
                const amount = totals.results[category].amount;
                const width = Math.max(Math.abs(amount) / maximum * 100, amount === 0 ? 0 : 3);
                const direction = amount < 0 ? 'negative' : amount > 0 ? 'positive' : 'neutral';
                return `<div class="scenario-bar-row"><span>${labels[category]}</span><div class="scenario-bar-track"><i class="scenario-bar scenario-bar--${direction}" style="width:${width}%"></i></div><strong>${formatMoney(amount, true)}</strong></div>`;
            }).join('');
        } else {
            scenarioBars.innerHTML = '<p>請先填妥主建物、附屬建物、共有部分的契約面積、實際面積與分項價款。</p>';
        }
        const builderInquirySection = element('builder-inquiry-section');
        builderInquirySection.hidden = isBlocked || !totals.actualBreakdownComplete;
        element('builder-inquiry-text').textContent = !isBlocked && totals.actualBreakdownComplete
            ? buildBuilderInquiry(data, totals, capScenario, compensable.categories)
            : '';
        element('builder-inquiry-copy-status').textContent = '';
        const usesClause4Total = Number.isFinite(data.basic.contractTotalArea) && data.basic.contractTotalArea > 0;
        const usesDeclaredActualTotal = Number.isFinite(data.basic.declaredTotalArea) && data.basic.declaredTotalArea >= 0;
        element('registered-contract-total-area').value = element('contract-total-area').value;
        element('total-difference-label').textContent = usesClause4Total ? '總面積差' : '暫估總面積差';
        element('total-rate-label').textContent = usesClause4Total ? '總面積誤差率' : '暫估總面積誤差率';
        element('total-rate-note').textContent = usesClause4Total ? '採第四條契約總面積計算' : '尚未輸入第四條契約總面積';
        element('total-area-formula').textContent = totals.houseAreasComplete
            ? `${usesClause4Total ? '第四條契約' : '分項暫估契約'} ${formatArea(totals.contractTotal)}；${usesDeclaredActualTotal ? '權狀登記' : '分項實際加總'} ${formatArea(totals.actualTotal)}`
            : '三項房屋面積資料尚未齊全';

        const clauseChecks = [];
        if (usesClause4Total && totals.contractBreakdownComplete) {
            const difference = Math.round((totals.calculatedContractTotal - data.basic.contractTotalArea) * 10000) / 10000;
            if (Math.abs(difference) < 0.0001) {
                clauseChecks.push('✓ 第四條總面積與主建物、附屬建物、共有部分契約面積加總一致。');
            } else if (Math.abs(difference) <= AREA_ROUNDING_TOLERANCE) {
                clauseChecks.push(`✓ 三項契約面積加總與第四條總面積相差 ${formatArea(difference, true)}，屬小數點後 2 位四捨五入尾差。`);
            } else {
                clauseChecks.push(`⚠ 三項契約面積加總與第四條總面積相差 ${formatArea(difference, true)}，請確認是否依契約正確抄錄。`);
            }
        }
        if (Number.isFinite(data.basic.exclusiveArea) && Number.isFinite(data.categories.main.contractArea) && Number.isFinite(data.categories.accessory.contractArea)) {
            const exclusiveDifference = Math.round((data.categories.main.contractArea + data.categories.accessory.contractArea - data.basic.exclusiveArea) * 10000) / 10000;
            if (Math.abs(exclusiveDifference) < 0.0001) {
                clauseChecks.push('✓ 專有部分與主建物、附屬建物契約面積加總一致。');
            } else if (Math.abs(exclusiveDifference) <= AREA_ROUNDING_TOLERANCE) {
                clauseChecks.push(`✓ 主建物與附屬建物加總和專有部分相差 ${formatArea(exclusiveDifference, true)}，屬小數點後 2 位四捨五入尾差。`);
            } else {
                clauseChecks.push(`⚠ 主建物與附屬建物加總和專有部分相差 ${formatArea(exclusiveDifference, true)}，請確認是否依契約正確抄錄。`);
            }
        }
        if (Number.isFinite(data.basic.contractMainRatio) && usesClause4Total && Number.isFinite(data.categories.main.contractArea)) {
            const calculatedRatio = data.categories.main.contractArea / data.basic.contractTotalArea * 100;
            const ratioDifference = calculatedRatio - data.basic.contractMainRatio;
            if (Math.abs(ratioDifference) <= RATIO_ROUNDING_TOLERANCE) {
                clauseChecks.push(`✓ 主建物比例核對一致（依面積計算 ${calculatedRatio.toFixed(2)}%）。`);
            } else {
                clauseChecks.push(`⚠ 依輸入面積計算為 ${calculatedRatio.toFixed(2)}%，與契約記載相差 ${ratioDifference > 0 ? '+' : ''}${ratioDifference.toFixed(2)} 個百分點，請確認是否依契約正確抄錄。`);
            }
        }
        if (data.basic.rainCoverTreatment === 'included'
            && Number.isFinite(data.basic.balconyArea) && Number.isFinite(data.basic.rainCoverArea) && Number.isFinite(data.categories.accessory.contractArea)
            && data.basic.balconyArea + data.basic.rainCoverArea > data.categories.accessory.contractArea + AREA_ROUNDING_TOLERANCE) {
            clauseChecks.push('⚠ 陽臺與雨遮面積合計大於附屬建物契約面積，請核對契約欄位。');
        }
        const clause4Consistency = element('clause4-consistency');
        clause4Consistency.hidden = clauseChecks.length === 0;
        clause4Consistency.innerHTML = clauseChecks.map((message) => `<p>${message}</p>`).join('');

        if (Number.isFinite(data.basic.declaredTotalArea) && totals.actualBreakdownComplete) {
            const discrepancy = data.basic.declaredTotalArea - totals.calculatedActualTotal;
            element('total-consistency').textContent = Math.abs(discrepancy) < 0.0001
                ? '權狀總面積與房屋分項實際面積加總一致。'
                : `權狀總面積與房屋分項加總相差 ${formatArea(discrepancy, true)}，請檢查車位、公設或契約定義。`;
        } else {
            element('total-consistency').textContent = '需填妥權狀總面積與三項房屋實際面積後核對。';
        }

        const warnings = buildWarnings(data, totals, !isBlocked);
        validation.warnings.forEach((message) => warnings.unshift(['', message]));
        validation.info.forEach((message) => warnings.push(['success', message]));
        if (isBlocked) warnings.unshift(['alert', '資料待核對：阻止性錯誤修正前，不顯示完整淨額、2% 情境淨額、建商結算差異，也不判定是否符合解除契約條件。']);
        element('warnings').innerHTML = warnings.map(([type, text]) => `<p class="warning-item${type ? ` warning-item--${type}` : ''}">${text}</p>`).join('');

        const hasBasicCalculation = Number.isFinite(totals.results.main.rate) || Number.isFinite(totals.totalRate) || Number.isFinite(totals.partialReferenceNet);
        const readyForReview = !isBlocked && hasBasicCalculation && Number.isFinite(totals.referenceNet);
        const status = element('calculation-status');
        status.className = `status-pill ${readyForReview ? 'status-pill--review' : !isBlocked && hasBasicCalculation ? 'status-pill--ready' : 'status-pill--incomplete'}`;
        status.textContent = isBlocked ? '資料待核對' : readyForReview ? '待核對建商結算' : hasBasicCalculation ? '可初步試算' : '資料未齊';
        element('status-detail').textContent = isBlocked ? '請先修正下方列出的欄位與面積比較範圍。' : readyForReview
            ? '主要計算資料已具備，仍需依完整契約核對 2% 上限及結算方式。'
            : hasBasicCalculation ? '已有部分結果；資料缺口與契約警示請見下方。' : '請先輸入契約與實際登記面積。';

        const builderSigned = Number.isFinite(data.basic.builderAmount)
            ? (data.basic.builderDirection === 'refund' ? -data.basic.builderAmount : data.basic.builderAmount)
            : null;
        element('builder-difference').textContent = !isBlocked && Number.isFinite(builderSigned) && Number.isFinite(totals.referenceNet)
            ? formatMoney(builderSigned - totals.referenceNet, true) : '—';
        element('generated-at').textContent = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
    }

    function saveData() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(collectData()));
            return true;
        } catch (error) {
            // Keep the calculator usable when browser storage is unavailable.
            return false;
        }
    }

    function loadStoredData() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return;
            const data = JSON.parse(stored);
            if (!validateData(data)) applyData(data);
        } catch (error) {
            // Keep the page defaults when stored data is unavailable or invalid.
        }
    }

    form.addEventListener('input', (event) => {
        let source = event.target;
        if (source.id === 'contract-main-ratio') source.dataset.valueSource = 'manual';
        if (source.matches('[data-area-pair]')) source = syncAreaPair(source);
        if (source.matches('[data-category-sync]')) syncCategoryFromClause(source);
        if (source.matches('[data-field="contractArea"]')) syncClauseFromCategory(source);
        if (['contract-total-area', 'clause-main-area'].includes(source.id)) updateMainRatio();
        render();
        saveData();
    });
    form.addEventListener('change', (event) => {
        if (event.target.matches('[data-area-pair]')) {
            const pingInput = syncAreaPair(event.target);
            if (pingInput.matches('[data-category-sync]')) syncCategoryFromClause(pingInput);
            if (['contract-total-area', 'clause-main-area'].includes(pingInput.id)) updateMainRatio();
        }
        render();
        saveData();
    });
    element('save-data').addEventListener('click', () => {
        const saved = saveData();
        if (saved) {
            const message = '資料已暫存在此瀏覽器。清除瀏覽器紀錄、網站資料或更換裝置後，資料可能遺失。\n\n重要資料請再使用「匯出 JSON」另存備份。';
            element('storage-message').textContent = '資料已儲存於此瀏覽器；清除瀏覽器資料後可能遺失。';
            window.alert(message);
        } else {
            const message = '無法儲存到此瀏覽器，可能是隱私模式或瀏覽器已禁用網站儲存。請改用「匯出 JSON」備份。';
            element('storage-message').textContent = message;
            window.alert(message);
        }
    });
    element('export-data').addEventListener('click', () => {
        const blob = new Blob([serializeAdjustmentData(collectData())], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `area-adjustment-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
        element('storage-message').textContent = 'JSON 已匯出。';
    });
    element('import-data').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            if (file.size > 1000000) throw new Error('檔案不可超過 1 MB。');
            const data = deserializeAdjustmentData(await file.text());
            applyData(data);
            saveData();
            element('storage-message').textContent = 'JSON 匯入成功，資料已還原並自動暫存。';
        } catch (error) {
            element('storage-message').textContent = `匯入失敗：${error.message} 目前資料未被覆蓋。`;
        } finally {
            event.target.value = '';
        }
    });
    element('copy-builder-inquiry').addEventListener('click', async () => {
        const text = element('builder-inquiry-text').textContent;
        const status = element('builder-inquiry-copy-status');
        try {
            await navigator.clipboard.writeText(text);
            status.textContent = '已複製，可直接貼給建商。';
        } catch (error) {
            const temporary = document.createElement('textarea');
            temporary.value = text;
            temporary.setAttribute('readonly', '');
            temporary.style.position = 'fixed';
            temporary.style.opacity = '0';
            document.body.appendChild(temporary);
            temporary.select();
            const copied = document.execCommand('copy');
            temporary.remove();
            status.textContent = copied ? '已複製，可直接貼給建商。' : '無法自動複製，請長按上方文字後複製。';
        }
    });

    loadStoredData();
    render();
}
