const STORAGE_KEY = 'calcloan.areaAdjustment.v1';
const DATA_VERSION = 1;
const CATEGORIES = ['main', 'accessory', 'shared', 'land'];
const HOUSE_CATEGORIES = CATEGORIES.slice(0, 3);
const MAX_AREA = 100000;
const MAX_MONEY = 10000000000;
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
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(number) ? number : null;
}

export function tenThousandsToTwd(value) {
    const amount = parseOptionalNumber(value);
    return Number.isFinite(amount) ? Math.round(amount * 10000) : null;
}

export function twdToTenThousands(value) {
    return Number.isFinite(value) ? value / 10000 : null;
}

export function calculateCategory({ contractArea, actualArea, price }, differenceOverride = null) {
    const hasAreas = Number.isFinite(contractArea) && contractArea > 0 && Number.isFinite(actualArea) && actualArea >= 0;
    const difference = Number.isFinite(differenceOverride)
        ? differenceOverride
        : hasAreas ? Math.round((actualArea - contractArea) * 10000) / 10000 : null;
    const rate = hasAreas ? Math.round((difference / contractArea * 100) * 100000000) / 100000000 : null;
    const unitPrice = Number.isFinite(price) && price >= 0 && Number.isFinite(contractArea) && contractArea > 0
        ? price / contractArea
        : null;
    const amount = Number.isFinite(difference) && Number.isFinite(unitPrice)
        ? Math.round(difference * unitPrice)
        : null;
    return { difference, rate, unitPrice, amount };
}

export function calculateTotals(categories, scenarioDifferences = null, contractTotalOverride = null, actualTotalOverride = null) {
    const results = {};
    CATEGORIES.forEach((category) => {
        results[category] = calculateCategory(
            categories[category],
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
        ? Math.round(HOUSE_CATEGORIES.reduce((sum, category) => sum + scenarioDifferences[category], 0) * 10000) / 10000
        : houseAreasComplete ? Math.round((actualTotal - contractTotal) * 10000) / 10000 : null;
    const totalRate = houseAreasComplete ? Math.round((totalDifference / contractTotal * 100) * 100000000) / 100000000 : null;
    const amountValues = HOUSE_CATEGORIES.map((category) => results[category].amount);
    const referenceNet = amountValues.some(Number.isFinite)
        ? amountValues.filter(Number.isFinite).reduce((sum, amount) => sum + amount, 0)
        : null;

    return { results, houseAreasComplete, contractBreakdownComplete, actualBreakdownComplete, calculatedContractTotal, calculatedActualTotal, contractTotal, actualTotal, totalDifference, totalRate, referenceNet };
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
    const absolute = moneyFormatter.format(Math.abs(Math.round(value))).replace('NT$', 'NT$ ');
    if (!signed || value === 0) return absolute;
    return `${value > 0 ? '+' : '−'}${absolute}`;
}

function formatTenThousands(value) {
    if (!Number.isFinite(value)) return '—';
    return `${tenThousandsFormatter.format(value / 10000)} 萬元`;
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

function validateData(data) {
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
    for (const key of ['contractTotalArea', 'exclusiveArea', 'balconyArea', 'rainCoverArea']) {
        if (data.basic[key] !== undefined && !valueInRange(data.basic[key], MAX_AREA, key === 'balconyArea' || key === 'rainCoverArea')) return `${key} 的數值無效。`;
    }
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
            paired.value = (value / 3.305785).toFixed(2);
            return paired;
        }
        paired.value = (value * 3.305785).toFixed(2);
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

    function syncAllContractUnits() {
        document.querySelectorAll('[data-area-unit="ping"]').forEach((input) => syncAreaPair(input));
    }

    function updateMainRatio() {
        const mainArea = readInput('clause-main-area');
        const totalArea = readInput('contract-total-area');
        element('contract-main-ratio').value = Number.isFinite(mainArea) && Number.isFinite(totalArea) && totalArea > 0
            ? (mainArea / totalArea * 100).toFixed(2)
            : '';
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
                contractMainRatio: readInput('contract-main-ratio'),
                squareMetres: Object.fromEntries(CONTRACT_SQM_INPUT_IDS.map((id) => [id, readInput(id)])),
                declaredTotalArea: readInput('declared-total-area'),
                suspectedChange: element('suspected-change').checked,
                changeNotes: element('change-notes').value,
                builderDirection: element('builder-direction').value,
                builderAmount: readMoneyInput('builder-amount'),
                builderNotes: element('builder-notes').value
            },
            categories
        };
    }

    function applyData(data) {
        const { basic } = data;
        ['parkingArea', 'contractTotalArea', 'exclusiveArea', 'balconyArea', 'rainCoverArea', 'contractMainRatio', 'declaredTotalArea'].forEach((key) => {
            const id = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
            writeInput(id, basic[key]);
        });
        ['totalPrice', 'parkingPrice', 'landPrice', 'builderAmount'].forEach((key) => {
            const id = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
            writeMoneyInput(id, basic[key]);
        });
        element('suspected-change').checked = Boolean(basic.suspectedChange);
        element('change-notes').value = basic.changeNotes || '';
        element('builder-direction').value = basic.builderDirection === 'payment' ? 'payment' : 'refund';
        element('builder-notes').value = basic.builderNotes || '';
        rows.forEach((row) => {
            const source = data.categories[row.dataset.category];
            ['contractArea', 'actualArea', 'price'].forEach((field) => {
                const input = row.querySelector(`[data-field="${field}"]`);
                input.value = field === 'price' && Number.isFinite(source[field]) ? String(source[field] / 10000) : source[field] ?? '';
            });
        });
        rows.forEach((row) => syncClauseFromCategory(row.querySelector('[data-field="contractArea"]')));
        syncAllContractUnits();
        if (basic.squareMetres) {
            CONTRACT_SQM_INPUT_IDS.forEach((id) => {
                if (Number.isFinite(basic.squareMetres[id])) writeInput(id, basic.squareMetres[id]);
            });
        }
        if (!Number.isFinite(basic.contractMainRatio)) updateMainRatio();
        render();
    }

    function validateInputs(data) {
        const errors = [];
        document.querySelectorAll('.field-error').forEach((node) => { node.textContent = ''; });
        if (!valueInRange(data.basic.totalPrice, MAX_MONEY)) errors.push('成交總價必須是 0 以上的有效金額。');
        if (!valueInRange(data.basic.parkingPrice, MAX_MONEY)) errors.push('車位價款必須是 0 以上的有效金額。');
        if (Number.isFinite(data.basic.totalPrice) && Number.isFinite(data.basic.parkingPrice) && data.basic.parkingPrice > data.basic.totalPrice) {
            document.querySelector('[data-error-for="parking-price"]').textContent = '車位價款不可大於成交總價。';
            errors.push('車位價款不可大於成交總價。');
        }
        for (const category of CATEGORIES) {
            const values = data.categories[category];
            if (!valueInRange(values.contractArea, MAX_AREA, false)) errors.push(`${category} 契約面積須大於 0。`);
            if (!valueInRange(values.actualArea, MAX_AREA)) errors.push(`${category} 實際面積不可為負。`);
            if (!valueInRange(values.price, MAX_MONEY)) errors.push(`${category} 價款不可為負。`);
            if (values.actualArea === 0) errors.push(`${category} 實際面積為 0，請核對登記資料。`);
        }
        for (const [key, label] of [['contractTotalArea', '第四條房屋總面積'], ['exclusiveArea', '專有部分面積']]) {
            if (!valueInRange(data.basic[key], MAX_AREA, false)) errors.push(`${label}須大於 0。`);
        }
        for (const [key, label] of [['balconyArea', '陽臺面積'], ['rainCoverArea', '雨遮面積']]) {
            if (!valueInRange(data.basic[key], MAX_AREA)) errors.push(`${label}不可為負。`);
        }
        if (!valueInRange(data.basic.contractMainRatio, 100)) errors.push('主建物比例須介於 0% 至 100%。');
        return [...new Set(errors)];
    }

    function setOutput(row, name, text, numericValue = null) {
        const output = row.querySelector(`[data-output="${name}"]`);
        output.textContent = text;
        output.classList.toggle('is-negative', Number.isFinite(numericValue) && numericValue < 0);
        output.classList.toggle('is-positive', Number.isFinite(numericValue) && numericValue > 0);
    }

    function buildWarnings(data, totals) {
        const warnings = [];
        const mainRate = totals.results.main.rate;
        const totalRate = totals.totalRate;
        const comparableRates = [mainRate, totalRate].filter(Number.isFinite);
        if (comparableRates.some((rate) => rate < 0)) warnings.push(['success', '契約第六條：主建物或房屋登記總面積不足時，不足部分應全部找補；金額仍依房屋分項單價計算一次。']);
        if (comparableRates.some((rate) => rate > 0)) warnings.push(['', '契約第六條：主建物或登記總面積增加時，買方找補以 2% 為限；上限如何落實於分項結算仍須核對完整契約與適用規範。']);
        if (comparableRates.some((rate) => Math.abs(rate) > 3)) warnings.push(['alert', '主建物或房屋登記總面積誤差絕對值大於 3%，可能符合第六條第三項解除契約條件，請進一步確認。']);
        if (!Number.isFinite(data.basic.contractTotalArea)) warnings.push(['', '第四條第一項已提供；請輸入契約記載的房屋總面積。目前總面積計算僅在分項齊全時採分項加總暫估。']);
        if (HOUSE_CATEGORIES.some((category) => !Number.isFinite(data.categories[category].price))) warnings.push(['', '分項價款未齊，不猜測單價；缺少價款的項目只顯示面積差與警示。']);
        if (data.basic.suspectedChange) warnings.push(['alert', '已標記疑似設計變更：請另行比對原始圖說、變更圖說與買方同意紀錄，不由面積差直接推論擅自變更。']);
        warnings.push(['', '未調整參考淨額是純算術分項價差加總；正式應退／應補金額仍為「待核對契約後確定」。']);
        return warnings;
    }

    function render() {
        const data = collectData();
        const errors = validateInputs(data);
        const totals = calculateTotals(data.categories, null, data.basic.contractTotalArea, data.basic.declaredTotalArea);

        const priceDifference = Number.isFinite(data.basic.totalPrice) && Number.isFinite(data.basic.parkingPrice)
            ? data.basic.totalPrice - data.basic.parkingPrice : null;
        element('price-excluding-parking').textContent = formatTenThousands(priceDifference);
        element('area-error').textContent = errors.join(' ');

        rows.forEach((row) => {
            const category = row.dataset.category;
            const result = totals.results[category];
            setOutput(row, 'difference', formatArea(result.difference, true), result.difference);
            if (category === 'land') {
                setOutput(row, 'rate', '待核對契約');
                setOutput(row, 'unitPrice', '待核對契約');
                setOutput(row, 'amount', '不計入房屋找補');
                return;
            }
            setOutput(row, 'rate', formatPercent(result.rate), result.rate);
            setOutput(row, 'unitPrice', formatMoney(result.unitPrice));
            setOutput(row, 'amount', formatMoney(result.amount, true), result.amount);
        });

        element('main-rate').textContent = formatPercent(totals.results.main.rate);
        element('main-formula').textContent = Number.isFinite(totals.results.main.rate)
            ? `(${formatArea(data.categories.main.actualArea)} − ${formatArea(data.categories.main.contractArea)}) ÷ ${formatArea(data.categories.main.contractArea)}`
            : '（實際 − 契約）÷ 契約';
        element('total-difference').textContent = formatArea(totals.totalDifference, true);
        element('total-rate').textContent = formatPercent(totals.totalRate);
        element('reference-net').textContent = formatMoney(totals.referenceNet, true);
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
        if (Number.isFinite(data.basic.balconyArea) && Number.isFinite(data.basic.rainCoverArea) && Number.isFinite(data.categories.accessory.contractArea)
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

        const warnings = buildWarnings(data, totals);
        element('warnings').innerHTML = warnings.map(([type, text]) => `<p class="warning-item${type ? ` warning-item--${type}` : ''}">${text}</p>`).join('');

        const hasBasicCalculation = Number.isFinite(totals.results.main.rate) || Number.isFinite(totals.totalRate) || Number.isFinite(totals.referenceNet);
        const readyForReview = hasBasicCalculation && Number.isFinite(totals.referenceNet);
        const status = element('calculation-status');
        status.className = `status-pill ${readyForReview ? 'status-pill--review' : hasBasicCalculation ? 'status-pill--ready' : 'status-pill--incomplete'}`;
        status.textContent = readyForReview ? '待核對建商結算' : hasBasicCalculation ? '可初步試算' : '資料未齊';
        element('status-detail').textContent = readyForReview
            ? '主要計算資料已具備，仍需依完整契約核對 2% 上限及結算方式。'
            : hasBasicCalculation ? '已有部分結果；資料缺口與契約警示請見下方。' : '請先輸入契約與實際登記面積。';

        const builderSigned = Number.isFinite(data.basic.builderAmount)
            ? (data.basic.builderDirection === 'refund' ? -data.basic.builderAmount : data.basic.builderAmount)
            : null;
        element('builder-difference').textContent = Number.isFinite(builderSigned) && Number.isFinite(totals.referenceNet)
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
        if (source.matches('[data-area-pair]')) source = syncAreaPair(source);
        if (source.matches('[data-category-sync]')) syncCategoryFromClause(source);
        if (source.matches('[data-field="contractArea"]')) syncClauseFromCategory(source);
        if (['contract-total-area', 'clause-main-area'].includes(source.id)) updateMainRatio();
        render();
        saveData();
    });
    form.addEventListener('change', (event) => {
        if (event.target.matches('[data-area-pair]')) {
            const value = parseOptionalNumber(event.target.value);
            if (Number.isFinite(value)) event.target.value = value.toFixed(2);
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
        const blob = new Blob([JSON.stringify(collectData(), null, 2)], { type: 'application/json' });
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
            const data = JSON.parse(await file.text());
            const validationError = validateData(data);
            if (validationError) throw new Error(validationError);
            applyData(data);
            saveData();
            element('storage-message').textContent = 'JSON 匯入成功，資料已還原並自動暫存。';
        } catch (error) {
            element('storage-message').textContent = `匯入失敗：${error.message} 目前資料未被覆蓋。`;
        } finally {
            event.target.value = '';
        }
    });

    loadStoredData();
    render();
}
