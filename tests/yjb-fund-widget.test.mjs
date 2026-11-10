import assert from 'node:assert/strict';
import widget from '../yjb-fund-widget.js';

const response = (data, status = 200) => ({
  status,
  json: async () => ({ code: 200, data }),
});

function textNodes(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'text') out.push(node);
  Object.values(node).forEach((value) => (Array.isArray(value)
    ? value.forEach((item) => textNodes(item, out))
    : textNodes(value, out)));
  return out;
}

function storage(seed, failWrites = false) {
  const values = new Map(Object.entries(seed || {}));
  return {
    getJSON: async (key) => values.get(key),
    setJSON: async (key, value) => {
      if (failWrites) throw new Error('storage unavailable');
      values.set(key, value);
    },
  };
}

function liveContext(family = 'systemLarge') {
  const holdings = [
    { fund_id: 101, money: 1000 },
    { fund_id: 102, money: 2000 },
  ];
  return {
    env: { YJB_TOKEN: 'test', YJB_SIGNING_SECRET: 'test' },
    widgetFamily: family,
    storage: storage(),
    http: {
      get: async (url) => {
        if (url.includes('/users/v1/user-account')) return response({ list: [{ id: 1 }] });
        if (url.includes('/fund-accounts/')) return response({ list: holdings });
        if (url.includes('/increase-rate')) {
          const id = Number(new URL(url).searchParams.get('fund_id'));
          return response({ weighted_increase_rate: id === 101 ? 1.2 : -0.4, increase_amount: id === 101 ? 12 : -8, market_status: 'open' });
        }
        throw new Error(url);
      },
      post: async (url) => url.includes('/market/v1/fund/batch')
        ? response(holdings.map((holding, index) => ({ fund_id: holding.fund_id, short_name: `基金${index + 1}` })))
        : response([]),
    },
  };
}

async function testFamilies() {
  for (const family of ['systemSmall', 'systemMedium', 'systemLarge', 'systemExtraLarge', 'accessoryRectangular', 'accessoryCircular', 'accessoryInline']) {
    const nodes = textNodes(await widget(liveContext(family)));
    const values = nodes.map((node) => String(node.text));
    assert(values.some((value) => value.includes('当日涨幅')), `${family} missing daily fields`);
    assert(values.some((value) => value.includes('开市')), `${family} missing market status`);
    assert(!values.some((value) => /持有收益|占比|字段上限/.test(value)), `${family} renders removed fields`);
    if (!family.startsWith('accessory')) {
      assert(values.some((value) => value.includes('Token 验证成功')), `${family} missing token status`);
    }
  }
}

async function testClosedStateAndFallbackParsing() {
  let quoteCalls = 0;
  const ctx = {
    env: { YJB_TOKEN: 'test', YJB_SIGNING_SECRET: 'test' },
    widgetFamily: 'systemLarge',
    storage: storage(),
    http: {
      get: async (url) => {
        if (url.includes('/users/v1/user-account')) return response({ list: [{ id: 1 }] });
        if (url.includes('/fund-accounts/')) return response({ list: [
          { fund_id: 201, money: 1000, market_status: 'closed' },
          { fund_id: 202, money: 1000, market_status: 'closed' },
          { fund_id: 203, market_status: 'closed' },
        ] });
        if (url.includes('/fund/')) {
          quoteCalls += 1;
          return response({});
        }
        throw new Error(url);
      },
      post: async () => response({ result: {
        one: { fund_id: 201, short_name: '休市基金一', day_growth_rate: 1 },
        two: { fund_id: 202, short_name: '休市基金二', day_growth_rate: -1 },
        three: { fund_id: 203, short_name: '无净值基金' },
      } }),
    },
  };
  const nodes = textNodes(await widget(ctx));
  const values = nodes.map((node) => String(node.text));
  const dots = nodes.filter((node) => node.text === '●');
  assert(values.some((value) => value.includes('休市 · 最后成功')));
  assert(values.some((value) => value.includes('Token 验证成功')));
  assert(values.some((value) => value.includes('休市基金一'))
    && values.some((value) => value.includes('休市基金二'))
    && values.some((value) => value.includes('无净值基金')));
  assert.equal(quoteCalls, 0, 'closed market should not request quote fallbacks');
  assert.equal(dots.length, 3);
  assert.deepEqual(dots.map((node) => node.textColor), ['#FF5B5B', '#FF5B5B', '#A9AAB5']);
}

async function testClosedLatestNavUsesGreenIndicator() {
  const ctx = {
    env: { YJB_TOKEN: 'test', YJB_SIGNING_SECRET: 'test' },
    widgetFamily: 'systemLarge',
    storage: storage(),
    http: {
      get: async (url) => {
        if (url.includes('/users/v1/user-account')) return response({ list: [{ id: 1 }] });
        if (url.includes('/fund-accounts/')) return response({ list: [
          { fund_id: 211, money: 1000, market_status: 'closed' },
          { fund_id: 212, money: 1000, last_net: 1.12, market_status: 'closed' },
        ] });
        if (url.includes('/increase-rate') || url.includes('/gz-data') || url.includes('/fund/overview') || url.includes('/fund-history-nav')) {
          throw new Error(`closed market should not request quote source: ${url}`);
        }
        throw new Error(url);
      },
      post: async () => response({ result: {
        one: { fund_id: 211, short_name: '已获取净值', nav: 1.2345, market_status: 'closed', day_growth_rate: 0.5 },
        two: { fund_id: 212, short_name: '持仓返回最新净值', market_status: 'closed', day_growth_rate: -0.5 },
      } }),
    },
  };
  const nodes = textNodes(await widget(ctx));
  const dots = nodes.filter((node) => node.text === '●');
  assert.equal(dots.length, 2);
  assert.deepEqual(dots.map((node) => node.textColor), ['#43C89A', '#43C89A']);
}

async function testStorageFailureDoesNotHideData() {
  const ctx = liveContext('systemMedium');
  ctx.storage = storage({}, true);
  const values = textNodes(await widget(ctx)).map((node) => String(node.text));
  assert(values.some((value) => value.includes('基金1')));
  assert(values.some((value) => value.includes('开市')));
  assert(!values.some((value) => value.includes('更新失败')));
}

async function testSourceCircuitBreakerAndBatchFallback() {
  const holdings = Array.from({ length: 5 }, (_, index) => ({
    fund_id: 301 + index,
    short_name: `持仓基金${index + 1}`,
    money: 1000,
  }));
  let rateCalls = 0;
  let estimateCalls = 0;
  const ctx = {
    env: { YJB_TOKEN: 'test', YJB_SIGNING_SECRET: 'test' },
    widgetFamily: 'systemLarge',
    storage: storage(),
    http: {
      get: async (url) => {
        if (url.includes('/users/v1/user-account')) return response({ list: [{ id: 1 }] });
        if (url.includes('/fund-accounts/')) return response({ list: holdings });
        if (url.includes('/increase-rate')) {
          rateCalls += 1;
          return response({});
        }
        if (url.includes('/gz-data')) {
          estimateCalls += 1;
          return response({ weighted_increase_rate: -0.7, market_status: 'open' });
        }
        throw new Error(url);
      },
      post: async (url) => {
        if (url.includes('/market/v1/fund/batch')) throw new Error('metadata source unavailable');
        throw new Error(url);
      },
    },
  };
  const values = textNodes(await widget(ctx)).map((node) => String(node.text));
  assert.equal(estimateCalls, holdings.length, 'estimate fallback should cover every holding');
  assert(rateCalls < holdings.length * 2, `source circuit breaker did not reduce probes: ${rateCalls}`);
  assert(holdings.every((holding) => values.some((value) => value.includes(holding.short_name))), 'holding names must survive metadata failure');
  assert(values.filter((value) => value.includes('当日涨幅')).length >= holdings.length);
}

async function testAmountOnlyPrimarySource() {
  let estimateCalls = 0;
  const ctx = {
    env: { YJB_TOKEN: 'test', YJB_SIGNING_SECRET: 'test' },
    widgetFamily: 'systemLarge',
    storage: storage(),
    http: {
      get: async (url) => {
        if (url.includes('/users/v1/user-account')) return response({ list: [{ id: 1 }] });
        if (url.includes('/fund-accounts/')) return response({ list: [{ fund_id: 401, money: 1000, short_name: '金额源基金' }] });
        if (url.includes('/increase-rate')) return response({ increase_amount: 7, market_status: 'open' });
        if (url.includes('/gz-data')) {
          estimateCalls += 1;
          return response({});
        }
        throw new Error(url);
      },
      post: async () => response([]),
    },
  };
  const values = textNodes(await widget(ctx)).map((node) => String(node.text));
  assert(values.some((value) => value.includes('当日涨幅金额 +7.00')));
  assert(values.some((value) => value.includes('开市 · 实时')));
  assert.equal(estimateCalls, 0, 'amount-only primary quote should not trigger fallbacks');
}

async function testTokenConfigurationStates() {
  const missingValues = textNodes(await widget({
    env: { YJB_SIGNING_SECRET: 'test' },
    widgetFamily: 'systemMedium',
    storage: storage(),
    http: { get: async () => response({}), post: async () => response({}) },
  })).map((node) => String(node.text));
  assert(missingValues.some((value) => value.includes('Token 验证失败 · 未配置')));

  const invalidValues = textNodes(await widget({
    env: { YJB_TOKEN: 'expired', YJB_SIGNING_SECRET: 'test' },
    widgetFamily: 'systemMedium',
    storage: storage(),
    http: {
      get: async () => ({ status: 401, json: async () => ({ code: 401, message: 'unauthorized' }) }),
      post: async () => response({}),
    },
  })).map((node) => String(node.text));
  assert(invalidValues.some((value) => value.includes('Token 验证失败 · 令牌无效')));
}

async function testQuoteSourceFailureIsVisibleWithCachedValues() {
  const ctx = {
    env: { YJB_TOKEN: 'test', YJB_SIGNING_SECRET: 'test' },
    widgetFamily: 'systemLarge',
    storage: storage({
      'yjb-fund-widget-cache-v2': {
        rows: [{
          id: '501', name: '缓存基金', dailyChangeAmount: 9.5, dailyChangePct: 0.8,
          dailyChangeIsLive: true, estimateNav: 1.2, lastNav: 1.1,
        }],
        marketStatus: '开市', updatedAt: '11/10 14:00', savedAt: Date.now(),
      },
    }),
    http: {
      get: async (url) => {
        if (url.includes('/users/v1/user-account')) return response({ list: [{ id: 1 }] });
        if (url.includes('/fund-accounts/')) return response({ list: [{ fund_id: 501, short_name: '缓存基金', money: 1000, market_status: 'open' }] });
        if (/increase-rate|gz-data|fund\/overview|fund-history-nav/.test(url)) {
          throw new Error('quote endpoint unavailable');
        }
        throw new Error(url);
      },
      post: async () => response([]),
    },
  };
  const nodes = textNodes(await widget(ctx));
  const values = nodes.map((node) => String(node.text));
  assert(values.some((value) => value.includes('开市 · 行情源请求失败')));
  assert(values.some((value) => value.includes('缓存基金')));
  assert(values.some((value) => value.includes('当日涨幅金额 +9.50')));
  const dot = nodes.find((node) => node.text === '●');
  assert.equal(dot.textColor, '#FF5B5B', 'cached quote must not be marked live');
}

async function testOverviewNestedQuoteFallback() {
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const makeContext = (valuationDate) => ({
    env: { YJB_TOKEN: 'test', YJB_SIGNING_SECRET: 'test' },
    widgetFamily: 'systemLarge',
    storage: storage(),
    http: {
      get: async (url) => {
        if (url.includes('/users/v1/user-account')) return response({ list: [{ id: 1 }] });
        if (url.includes('/fund-accounts/')) return response({ list: [{ fund_id: 601, short_name: '嵌套估值基金', money: 1000 }] });
        if (url.includes('/increase-rate')) return {
          status: 200, json: async () => ({ code: 1001, message: '暂无持仓重仓股信息' }),
        };
        if (url.includes('/gz-data')) return response({ day: today, list: null });
        if (url.includes('/fund/overview')) return response({
          code: '000601', market_status: 'open', rate: null, nv_info: {
            code: '000601',
            vgszzl: '1.25', vgsz: '1.0125', dwjz: '1.0',
            time: new Date().toISOString(), gztime: today, true_valuation_date: valuationDate,
          },
        });
        throw new Error(url);
      },
      post: async () => response([]),
    },
  });
  const liveNodes = textNodes(await widget(makeContext(today)));
  const liveValues = liveNodes.map((node) => String(node.text));
  assert(liveValues.some((value) => value.includes('开市 · 实时')));
  assert(liveValues.some((value) => value.includes('当日涨幅 +1.25%')));
  assert.equal(liveNodes.find((node) => node.text === '●').textColor, '#43C89A');

  const staleNodes = textNodes(await widget(makeContext('2000-01-01')));
  const staleValues = staleNodes.map((node) => String(node.text));
  assert(staleValues.some((value) => value.includes('开市 · 数据延迟')));
  assert.equal(staleNodes.find((node) => node.text === '●').textColor, '#FF5B5B');
}

async function testSlowQuoteCompletesBeforeFetchDeadline() {
  const ctx = liveContext('systemLarge');
  const originalGet = ctx.http.get;
  ctx.http.get = async (url) => {
    if (url.includes('/increase-rate')) {
      await new Promise((resolve) => setTimeout(resolve, 11000));
      return response({ weighted_increase_rate: 0.6, increase_amount: 6, market_status: 'open' });
    }
    return originalGet(url);
  };
  const values = textNodes(await widget(ctx)).map((node) => String(node.text));
  assert(values.some((value) => value.includes('开市 · 实时')));
  assert(values.some((value) => value.includes('当日涨幅金额 +6.00')));
}

await testFamilies();
await testClosedStateAndFallbackParsing();
await testClosedLatestNavUsesGreenIndicator();
await testStorageFailureDoesNotHideData();
await testSourceCircuitBreakerAndBatchFallback();
await testAmountOnlyPrimarySource();
await testTokenConfigurationStates();
await testQuoteSourceFailureIsVisibleWithCachedValues();
await testOverviewNestedQuoteFallback();
await testSlowQuoteCompletesBeforeFetchDeadline();
console.log('PASS: widget families, token and quote-source states, slow-fetch recovery, closed-state semantics, and storage isolation');
