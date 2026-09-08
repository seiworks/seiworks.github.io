(function () {
    'use strict';

    function monthlyPayment(principal, annualRate, months) {
        if (principal <= 0 || months <= 0) return 0;
        const monthlyRate = annualRate / 100 / 12;
        if (monthlyRate === 0) return principal / months;
        const factor = Math.pow(1 + monthlyRate, months);
        return principal * monthlyRate * factor / (factor - 1);
    }

    function buildLoanSchedule(principal, annualRate, years, graceYears) {
        const totalMonths = Math.round(years * 12);
        const graceMonths = Math.min(Math.round(graceYears * 12), totalMonths - 1);
        const repaymentMonths = totalMonths - graceMonths;
        const interestOnlyPayment = principal * annualRate / 100 / 12;
        const amortizedPayment = monthlyPayment(principal, annualRate, repaymentMonths);
        const schedule = [];
        const interestSchedule = [];
        const balanceSchedule = [];
        let balance = principal;

        for (let month = 0; month < totalMonths; month += 1) {
            const interest = balance * annualRate / 100 / 12;
            const payment = month < graceMonths ? interestOnlyPayment : amortizedPayment;
            if (month >= graceMonths) balance = Math.max(0, balance - (payment - interest));
            schedule.push(payment);
            interestSchedule.push(interest);
            balanceSchedule.push(balance);
        }

        return {
            principal,
            annualRate,
            years,
            graceYears,
            schedule,
            interestSchedule,
            balanceSchedule,
            totalInterest: interestSchedule.reduce((sum, interest) => sum + interest, 0)
        };
    }

    function combineLoans(loans) {
        const duration = Math.max(...loans.map((loan) => loan.schedule.length));
        const combinedSchedule = Array.from({ length: duration }, (_, month) => (
            loans.reduce((sum, loan) => sum + (loan.schedule[month] || 0), 0)
        ));

        return {
            initialPayment: combinedSchedule[0] || 0,
            peakPayment: Math.max(...combinedSchedule, 0),
            totalInterest: loans.reduce((sum, loan) => sum + loan.totalInterest, 0)
        };
    }

    function buildMonthlyDetails(loans) {
        const duration = Math.max(...loans.map((loan) => loan.schedule.length));
        return Array.from({ length: duration }, (_, month) => {
            const activeLoans = loans.filter((loan) => month < loan.schedule.length);
            const graceLoans = activeLoans.filter((loan) => month < loan.graceYears * 12);
            const payment = activeLoans.reduce((sum, loan) => sum + loan.schedule[month], 0);
            const interest = activeLoans.reduce((sum, loan) => sum + loan.interestSchedule[month], 0);
            const balance = activeLoans.reduce((sum, loan) => sum + loan.balanceSchedule[month], 0);
            let phase = '本金攤還';
            if (graceLoans.length === activeLoans.length && activeLoans.length) phase = '寬限期';
            else if (graceLoans.length) phase = '部分寬限';

            return {
                month: month + 1,
                phase,
                payment,
                interest,
                principal: Math.max(0, payment - interest),
                balance
            };
        });
    }

    function createScenario({ id, name, housePrice, ltv, standard, fee = 0 }) {
        const totalLoan = housePrice * ltv;
        const cash = housePrice - totalLoan;
        const loans = [{
            name: '一般房貸',
            ...buildLoanSchedule(totalLoan, standard.rate, standard.years, standard.grace)
        }];

        const combined = combineLoans(loans);
        const postGraceMonth = Math.max(...loans.map((loan) => loan.graceYears * 12));
        const postGracePayment = loans.reduce((sum, loan) => sum + (loan.schedule[postGraceMonth] || 0), 0);
        const interestWithin = (months) => loans.reduce((total, loan) => (
            total + loan.interestSchedule.slice(0, months).reduce((sum, interest) => sum + interest, 0)
        ), 0);
        return {
            id,
            name,
            ltv,
            totalLoan,
            cash,
            fee,
            loans,
            monthlyDetails: buildMonthlyDetails(loans),
            ...combined,
            postGracePayment,
            paymentJump: Math.max(0, postGracePayment - combined.initialPayment),
            totalCost: combined.totalInterest + fee,
            fiveYearCost: interestWithin(60) + fee
        };
    }

    function rankScenarios(scenarios, objective) {
        return [...scenarios].sort((a, b) => {
            const metric = objective;
            const difference = a[metric] - b[metric];
            return difference || a.totalInterest - b.totalInterest || a.peakPayment - b.peakPayment;
        });
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { monthlyPayment, buildLoanSchedule, combineLoans, buildMonthlyDetails, createScenario, rankScenarios };
    }

    if (typeof document === 'undefined') return;

    const form = document.querySelector('#mortgage-form');
    const results = document.querySelector('#mortgage-results');
    const comparisonBody = document.querySelector('#comparison-body');
    const recommendation = document.querySelector('#recommendation');
    const breakdown = document.querySelector('#loan-breakdown');
    const context = document.querySelector('#result-context');
    const error = document.querySelector('#form-error');
    const offerList = document.querySelector('#offer-list');
    const offerTemplate = document.querySelector('#offer-template');
    const addOfferButton = document.querySelector('#add-offer');
    const resetButton = document.querySelector('#reset-calculator');
    const housePriceInput = document.querySelector('#house-price');
    const objectiveSelect = document.querySelector('#objective');
    const objectiveHelp = document.querySelector('#objective-help');
    let offerSequence = 0;
    let initialCalculation = true;
    const HOUSE_PRICE_STORAGE_KEY = 'calcloan.housePrice';
    const DEFAULT_HOUSE_PRICE = '1500';

    const currency = new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        maximumFractionDigits: 0
    });
    const money = (value) => currency.format(value);
    const wan = (value) => `${new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 }).format(value / 10000)} 萬`;
    const getNumber = (selector, root = document) => Number(root.querySelector(selector).value) * 10000;
    const getPlainNumber = (selector, root = document) => Number(root.querySelector(selector).value);
    const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);

    function renumberOffers() {
        [...offerList.querySelectorAll('.mortgage-offer')].forEach((offer, index) => {
            offer.querySelector('.mortgage-offer__index').textContent = `方案 ${index + 1}`;
        });
    }

    function addOffer(defaults = {}) {
        offerSequence += 1;
        const fragment = offerTemplate.content.cloneNode(true);
        const offer = fragment.querySelector('.mortgage-offer');
        offer.dataset.offerId = String(offerSequence);
        offer.querySelector('.offer-name').value = defaults.name || '銀行方案';
        offer.querySelector('.offer-ltv').value = defaults.ltv || '0.8';

        Object.entries(defaults).forEach(([key, value]) => {
            const input = offer.querySelector(`.${key}`);
            if (input) input.value = value;
        });

        offer.querySelector('.mortgage-remove-button').addEventListener('click', () => {
            if (offerList.children.length <= 1) {
                error.textContent = '至少需要保留一個銀行方案。';
                return;
            }
            offer.remove();
            renumberOffers();
            error.textContent = '';
        });
        offerList.append(fragment);
        renumberOffers();
    }

    function addDefaultOffers() {
        offerList.replaceChildren();
        offerSequence = 0;
        addOffer({ name: '銀行 A・方案一', ltv: '0.8' });
        addOffer({
            name: '銀行 B・方案一',
            ltv: '0.8',
            'standard-years': 40,
            'standard-grace': 0,
            'standard-rate': 2.5
        });
    }

    function restoreHousePrice() {
        try {
            const storedValue = localStorage.getItem(HOUSE_PRICE_STORAGE_KEY);
            if (storedValue && Number(storedValue) > 0) housePriceInput.value = storedValue;
        } catch (error) {
            // Keep working when browser storage is unavailable.
        }
    }

    function storeHousePrice() {
        if (!housePriceInput.validity.valid || Number(housePriceInput.value) <= 0) return;
        try {
            localStorage.setItem(HOUSE_PRICE_STORAGE_KEY, housePriceInput.value);
        } catch (error) {
            // Keep working when browser storage is unavailable.
        }
    }

    function resetCalculator() {
        try {
            localStorage.removeItem(HOUSE_PRICE_STORAGE_KEY);
        } catch (error) {
            // Keep working when browser storage is unavailable.
        }
        form.reset();
        housePriceInput.value = DEFAULT_HOUSE_PRICE;
        addDefaultOffers();
        error.textContent = '';
        updateObjectiveHelp();
        initialCalculation = true;
        form.requestSubmit();
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function objectiveLabel(objective) {
        return {
            peakPayment: '任何月份都不要繳太高',
            postGracePayment: '寬限期後，每月繳最少',
            paymentJump: '寬限期結束，月付增加最少',
            totalCost: '全部繳完，利息與費用最少',
            fiveYearCost: '只看前 5 年，利息與費用最少'
        }[objective];
    }

    function updateObjectiveHelp() {
        objectiveHelp.textContent = {
            totalCost: '比較整段貸款產生的全部利息，加上銀行相關費用。',
            postGracePayment: '比較寬限期結束、開始償還本金後，每個月需要繳多少。',
            peakPayment: '比較整段貸款期間，各方案可能出現的最高單月繳款。',
            paymentJump: '比較寬限期結束前後，月付金額一次增加多少。',
            fiveYearCost: '適合短期可能換屋或轉貸，只比較前 5 年利息與銀行費用。'
        }[objectiveSelect.value];
    }

    function metricValue(scenario, objective) {
        return scenario[objective];
    }

    function metricDisplay(scenario, objective) {
        const value = metricValue(scenario, objective);
        return ['postGracePayment', 'peakPayment', 'paymentJump'].includes(objective)
            ? money(value)
            : wan(value);
    }

    function render(scenarios, objective, housePrice) {
        const ranked = rankScenarios(scenarios, objective);
        const best = ranked[0];
        const bestValue = metricValue(best, objective);
        const bestName = escapeHtml(best.name);
        context.textContent = `房屋總價 ${wan(housePrice)}・以「${objectiveLabel(objective)}」排序`;
        recommendation.innerHTML = `
            <div>
                <span>建議方案</span>
                <h3>${bestName}・${best.ltv * 100}%</h3>
            </div>
            <div class="mortgage-recommendation__metrics">
                <p><span>判斷指標</span><strong>${metricDisplay(best, objective)}</strong></p>
                <p><span>最高月付</span><strong>${money(best.peakPayment)}</strong></p>
                <p><span>利息＋費用</span><strong>${wan(best.totalCost)}</strong></p>
            </div>`;

        comparisonBody.innerHTML = scenarios.map((scenario) => {
            const composition = scenario.loans.map((loan) => `${loan.name} ${wan(loan.principal)}`).join('＋');
            const tied = Math.abs(metricValue(scenario, objective) - bestValue) < 1;
            const scenarioName = escapeHtml(scenario.name);
            return `
                <tr class="${tied ? 'is-best' : ''}" data-scenario="${scenario.id}">
                    <td><button type="button" class="mortgage-row-button" data-scenario="${scenario.id}">${scenario.id === best.id ? '<b>最佳</b>' : ''}${scenarioName}</button></td>
                    <td>${scenario.ltv * 100}%</td>
                    <td>${wan(scenario.cash)}</td>
                    <td>${money(scenario.initialPayment)}</td>
                    <td>${money(scenario.postGracePayment)}</td>
                    <td>${money(scenario.peakPayment)}</td>
                    <td>${wan(scenario.totalCost)}</td>
                    <td>${composition}</td>
                </tr>`;
        }).join('');

        function showBreakdown(scenario) {
            const scenarioName = escapeHtml(scenario.name);
            const monthlyRows = scenario.monthlyDetails.map((detail) => `
                <tr>
                    <td>第 ${detail.month} 月</td>
                    <td>${detail.phase}</td>
                    <td>${money(detail.payment)}</td>
                    <td>${money(detail.interest)}</td>
                    <td>${money(detail.principal)}</td>
                    <td>${money(detail.balance)}</td>
                </tr>`).join('');
            breakdown.innerHTML = `
                <div class="mortgage-breakdown__heading">
                    <span>方案明細</span>
                    <strong>${scenarioName}・${scenario.ltv * 100}%・貸款 ${wan(scenario.totalLoan)}</strong>
                </div>
                <div class="mortgage-breakdown__loans">
                    ${scenario.loans.map((loan) => `
                        <article>
                            <h3>${loan.name}</h3>
                            <p><span>本金</span><strong>${wan(loan.principal)}</strong></p>
                            <p><span>條件</span><strong>${loan.years} 年／寬限 ${loan.graceYears} 年／${loan.annualRate}%</strong></p>
                            <p><span>個別總利息</span><strong>${wan(loan.totalInterest)}</strong></p>
                        </article>`).join('')}
                </div>
                <p class="mortgage-breakdown__summary">寬限期後月付 ${money(scenario.postGracePayment)}・月付跳升 ${money(scenario.paymentJump)}・前 5 年利息與費用 ${wan(scenario.fiveYearCost)}</p>
                <details class="mortgage-monthly-details">
                    <summary>查看每月月付明細（共 ${scenario.monthlyDetails.length} 個月）</summary>
                    <div class="mortgage-monthly-table-wrap">
                        <table class="mortgage-monthly-table">
                            <thead><tr><th>期數</th><th>階段</th><th>月付</th><th>利息</th><th>本金</th><th>剩餘本金</th></tr></thead>
                            <tbody>${monthlyRows}</tbody>
                        </table>
                    </div>
                </details>`;
            comparisonBody.querySelectorAll('tr').forEach((row) => {
                row.classList.toggle('is-selected', row.dataset.scenario === scenario.id);
            });
        }

        comparisonBody.querySelectorAll('.mortgage-row-button').forEach((button) => {
            button.addEventListener('click', () => {
                showBreakdown(scenarios.find((scenario) => scenario.id === button.dataset.scenario));
            });
        });
        showBreakdown(best);
        results.hidden = false;
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        error.textContent = '';
        if (!form.reportValidity()) return;

        const housePrice = getNumber('#house-price');
        const offers = [...offerList.querySelectorAll('.mortgage-offer')];
        const scenarios = [];

        for (const offer of offers) {
            const standard = {
                years: getPlainNumber('.standard-years', offer),
                grace: getPlainNumber('.standard-grace', offer),
                rate: getPlainNumber('.standard-rate', offer)
            };

            if (standard.grace >= standard.years) {
                error.textContent = `${offer.querySelector('.offer-name').value}：寬限期必須短於貸款年限。`;
                return;
            }

            scenarios.push(createScenario({
                id: offer.dataset.offerId,
                name: offer.querySelector('.offer-name').value.trim(),
                housePrice,
                ltv: Number(offer.querySelector('.offer-ltv').value),
                fee: getPlainNumber('.origination-fee', offer)
                    + getPlainNumber('.management-fee', offer)
                    + getPlainNumber('.other-fee', offer),
                standard
            }));
        }

        render(scenarios, objectiveSelect.value, housePrice);
        if (!initialCalculation) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        initialCalculation = false;
    });

    addOfferButton.addEventListener('click', () => addOffer());
    resetButton.addEventListener('click', resetCalculator);
    housePriceInput.addEventListener('input', storeHousePrice);
    objectiveSelect.addEventListener('change', updateObjectiveHelp);
    restoreHousePrice();
    addDefaultOffers();
    updateObjectiveHelp();
    form.requestSubmit();
}());
