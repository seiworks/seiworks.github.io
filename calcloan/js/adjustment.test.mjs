import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    calculateCategory,
    calculateTotals,
    calculateTwoPercentScenario,
    buildBuilderInquiry,
    convertArea,
    deserializeAdjustmentData,
    exceedsThreePercent,
    prepareCompensableCategories,
    serializeAdjustmentData
} from './adjustment.js';

const emptyLand = { contractArea: null, actualArea: null, price: null };
const scriptPath = fileURLToPath(new URL('./adjustment.js', import.meta.url));
const htmlPath = fileURLToPath(new URL('../adjustment.html', import.meta.url));

function houseCategories(overrides = {}) {
    return {
        main: { contractArea: 20, actualArea: 20, price: 8000000 },
        accessory: { contractArea: 2, actualArea: 2, price: 800000 },
        shared: { contractArea: 10, actualArea: 10, price: 3000000 },
        land: { ...emptyLand },
        ...overrides
    };
}

test('面積減少：20 坪對 19.8 坪為 -1% 與 -8 萬元', () => {
    const result = calculateCategory({ contractArea: 20, actualArea: 19.8, price: 8000000 });
    assert.ok(Math.abs(result.difference + 0.2) < 1e-12);
    assert.ok(Math.abs(result.rate + 1) < 1e-12);
    assert.equal(result.unitPrice, 400000);
    assert.equal(result.amount, -80000);
});

test('面積增加：保留未調整價差並可產生 2% 假設情境', () => {
    const categories = houseCategories({
        main: { contractArea: 20, actualArea: 21, price: 8000000 }
    });
    const totals = calculateTotals(categories);
    const scenario = calculateTwoPercentScenario(categories, totals.results);
    assert.equal(totals.results.main.amount, 400000);
    assert.equal(scenario.items.main.assumedDifference, 0.4);
    assert.equal(scenario.items.main.assumedAmount, 160000);
});

test('2% 情境案例：25 坪增加至 27 坪時只計 0.5 坪、16 萬元', () => {
    const categories = houseCategories({
        main: { contractArea: 25, actualArea: 27, price: 8000000 }
    });
    const totals = calculateTotals(categories);
    const scenario = calculateTwoPercentScenario(categories, totals.results);
    assert.equal(totals.results.main.unitPrice, 320000);
    assert.equal(totals.results.main.difference, 2);
    assert.equal(totals.results.main.rate, 8);
    assert.equal(scenario.items.main.assumedDifference, 0.5);
    assert.equal(scenario.items.main.assumedAmount, 160000);

    const exactCategories = houseCategories({
        main: { contractArea: 25, actualArea: 25.5, price: 8000000 }
    });
    const exactTotals = calculateTotals(exactCategories);
    const exactScenario = calculateTwoPercentScenario(exactCategories, exactTotals.results);
    assert.equal(exactScenario.items.main.assumedDifference, 0.5);
    assert.equal(exactScenario.items.main.assumedAmount, 160000);
});

test('建商詢問稿會代入分項數值與 2% 假設結果', () => {
    const categories = houseCategories({
        main: { contractArea: 25, actualArea: 27, price: 8000000 }
    });
    const totals = calculateTotals(categories);
    const scenario = calculateTwoPercentScenario(categories, totals.results);
    const inquiry = buildBuilderInquiry({ categories }, totals, scenario);
    assert.match(inquiry, /主建物：契約 25\.000 坪，實際登記 27\.000 坪/);
    assert.match(inquiry, /單價 NT\$ 320,000／坪/);
    assert.match(inquiry, /試算結果為 \+NT\$ 160,000/);
    assert.match(inquiry, /這只是情境試算，不是我認定的正式結算金額/);
});

test('雨遮未確認時不假設為零，附屬建物不列入完整淨額', () => {
    const data = {
        basic: { rainCoverTreatment: 'pending', rainCoverArea: null, actualRainCoverArea: null, accessoryPriceBasis: 'pending' },
        categories: houseCategories()
    };
    const prepared = prepareCompensableCategories(data);
    const totals = calculateTotals(data.categories, null, null, null, prepared.categories);
    assert.equal(prepared.ready, false);
    assert.equal(totals.results.accessory.amount, null);
    assert.equal(totals.completedAmountCount, 2);
    assert.equal(totals.referenceNet, null);
});

test('契約確認無雨遮時，附屬建物直接納入完整淨額', () => {
    const data = {
        basic: { rainCoverTreatment: 'none', rainCoverArea: 0, actualRainCoverArea: 0, accessoryPriceBasis: 'compensable' },
        categories: houseCategories({
            accessory: { contractArea: 2, actualArea: 1.9, price: 800000 }
        })
    };
    const prepared = prepareCompensableCategories(data);
    const totals = calculateTotals(data.categories, null, null, null, prepared.categories);
    assert.equal(prepared.ready, true);
    assert.equal(totals.results.accessory.amount, -40000);
    assert.ok(Number.isFinite(totals.referenceNet));
});

test('附屬建物總面積包含雨遮時，契約與實際面積各自扣除後計價', () => {
    const data = {
        basic: {
            rainCoverTreatment: 'included',
            rainCoverArea: 0.5,
            actualRainCoverArea: 0.4,
            accessoryPriceBasis: 'compensable'
        },
        categories: houseCategories({
            accessory: { contractArea: 3, actualArea: 3.1, price: 1000000 }
        })
    };
    const prepared = prepareCompensableCategories(data);
    const totals = calculateTotals(data.categories, null, null, null, prepared.categories);
    assert.equal(prepared.ready, true);
    assert.equal(prepared.categories.accessory.contractArea, 2.5);
    assert.ok(Math.abs(prepared.categories.accessory.actualArea - 2.7) < 1e-12);
    assert.ok(Math.abs(totals.results.accessory.difference - 0.2) < 1e-12);
    assert.equal(totals.results.accessory.amount, 80000);
    assert.ok(Number.isFinite(totals.referenceNet));
});

test('主建物減少而公設增加：分項價差只各計一次', () => {
    const categories = houseCategories({
        main: { contractArea: 20, actualArea: 19.74, price: 8000000 },
        accessory: { contractArea: 2, actualArea: 1.74, price: 800000 },
        shared: { contractArea: 10, actualArea: 10.28, price: 3000000 }
    });
    const totals = calculateTotals(categories);
    const scenario = calculateTwoPercentScenario(categories, totals.results);
    assert.ok(Math.abs(totals.totalDifference + 0.24) < 1e-12);
    assert.equal(totals.referenceNet, -124000);
    assert.equal(scenario.items.main.assumedAmount, -104000);
    assert.equal(scenario.items.accessory.assumedAmount, -104000);
    assert.equal(scenario.items.shared.assumedAmount, 60000);
    assert.equal(scenario.amount, -148000);
});

test('缺少分項價款時只有部分小計，不顯示完整淨額', () => {
    const categories = houseCategories({
        shared: { contractArea: 10, actualArea: 10.2, price: null }
    });
    const totals = calculateTotals(categories);
    assert.equal(totals.completedAmountCount, 2);
    assert.equal(totals.partialReferenceNet, 0);
    assert.equal(totals.referenceNet, null);

    const missingArea = calculateTotals(houseCategories({
        accessory: { contractArea: 2, actualArea: null, price: 800000 }
    }));
    assert.equal(missingArea.completedAmountCount, 2);
    assert.equal(missingArea.referenceNet, null);
});

test('三項實際登記面積全部填妥後才視為可產生詢問內容', () => {
    const complete = calculateTotals(houseCategories());
    const incomplete = calculateTotals(houseCategories({
        shared: { contractArea: 10, actualArea: null, price: 3000000 }
    }));
    assert.equal(complete.actualBreakdownComplete, true);
    assert.equal(incomplete.actualBreakdownComplete, false);
});

test('3% 解約門檻嚴格採大於，正負 3% 都不觸發', () => {
    const minusThree = calculateCategory({ contractArea: 20, actualArea: 19.4, price: 8000000 });
    const plusThree = calculateCategory({ contractArea: 20, actualArea: 20.6, price: 8000000 });
    const beyond = calculateCategory({ contractArea: 20, actualArea: 19.39, price: 8000000 });
    assert.equal(exceedsThreePercent(minusThree.rate), false);
    assert.equal(exceedsThreePercent(plusThree.rate), false);
    assert.equal(exceedsThreePercent(beyond.rate), true);
    assert.equal(exceedsThreePercent(3.0000000001), true);
});

test('平方公尺與坪數換算不在輸入階段限制為兩位小數', () => {
    const ping = 35.12345678;
    const restored = convertArea(convertArea(ping, 'ping'), 'sqm');
    assert.ok(Math.abs(restored - ping) < 1e-10);
});

test('JSON 匯出再匯入完整保留欄位、空值與手動面積精度', () => {
    const data = {
        version: 1,
        savedAt: '2026-10-13T01:23:45.678Z',
        basic: {
            totalPrice: null,
            parkingPrice: 2350000,
            parkingArea: null,
            landPrice: null,
            contractTotalArea: 32.12345678,
            exclusiveArea: 22.98765432,
            balconyArea: 1.23456789,
            rainCoverArea: 0,
            actualRainCoverArea: 0.12345678,
            rainCoverTreatment: 'included',
            accessoryPriceBasis: 'compensable',
            contractMainRatio: 60.71,
            squareMetres: {
                'contract-total-area-sqm': 106.19384721,
                'exclusive-area-sqm': 76.00000001,
                'clause-main-area-sqm': 64.12345678,
                'clause-accessory-area-sqm': 11.87654323,
                'balcony-area-sqm': 4.08123456,
                'rain-cover-area-sqm': 0,
                'clause-shared-area-sqm': 30.1938472
            },
            declaredTotalArea: null,
            suspectedChange: false,
            changeNotes: '',
            builderDirection: 'refund',
            builderAmount: 123456,
            builderNotes: ''
        },
        categories: houseCategories({
            main: { contractArea: 19.39876543, actualArea: null, price: null },
            accessory: { contractArea: 3.58888889, actualArea: null, price: null },
            shared: { contractArea: 9.13580246, actualArea: null, price: null }
        })
    };
    const restored = deserializeAdjustmentData(serializeAdjustmentData(data));
    assert.deepEqual(restored, data);
    assert.throws(() => deserializeAdjustmentData('{"version":999}'), /JSON 版本不符/);
});

test('JavaScript 取用的所有固定 DOM ID 都存在於 adjustment.html', () => {
    const script = readFileSync(scriptPath, 'utf8');
    const html = readFileSync(htmlPath, 'utf8');
    const helperIds = [...script.matchAll(/element\('([^']+)'\)/g)].map((match) => match[1]);
    const selectorIds = [...script.matchAll(/querySelector(?:All)?\('#([a-zA-Z][\w-]*)/g)].map((match) => match[1]);
    const nativeIds = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]);
    const referencedIds = [...helperIds, ...selectorIds, ...nativeIds];
    const missingIds = [...new Set(referencedIds)].filter((id) => !html.includes(`id="${id}"`));
    assert.deepEqual(missingIds, []);
});
