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
      } }),
    },
  };
  const nodes = textNodes(await widget(ctx));
  const values = nodes.map((node) => String(node.text));
  const dots = nodes.filter((node) => node.text === '●');
  assert(values.some((value) => value.includes('休市 · 最后成功')));
  assert(values.some((value) => value.includes('休市基金一')) && values.some((value) => value.includes('休市基金二')));
  assert.equal(quoteCalls, 0, 'closed market should not request quote fallbacks');
  assert.equal(dots.length, 2);
  assert(dots.every((node) => node.textColor === '#FF5B5B'), 'closed values must be marked delayed');
}

async function testStorageFailureDoesNotHideData() {
  const ctx = liveContext('systemMedium');
  ctx.storage = storage({}, true);
  const values = textNodes(await widget(ctx)).map((node) => String(node.text));
  assert(values.some((value) => value.includes('基金1')));
  assert(values.some((value) => value.includes('开市')));
  assert(!values.some((value) => value.includes('更新失败')));
}

await testFamilies();
await testClosedStateAndFallbackParsing();
await testStorageFailureDoesNotHideData();
console.log('PASS: widget families, closed-state semantics, response wrappers, and storage-failure isolation');
