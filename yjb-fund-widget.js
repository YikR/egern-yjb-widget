const DEFAULT_BASE = 'https://app-api.yangjibao.com';
const CACHE_KEY = 'yjb-fund-widget-cache-v1';
const CACHE_TTL_SECONDS = 60 * 60 * 24;

function text(value, size, weight, color, maxLines = 1) {
  return {
    type: 'text',
    text: String(value),
    font: { size, weight },
    textColor: color,
    maxLines,
    minScale: 0.7,
  };
}

function formatNumber(value, suffix = '') {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}${suffix}`;
}

function pickNumber(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function unwrap(value) {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) break;
    if (current.code !== undefined && Number(current.code) !== 200) {
      throw new Error(current.message || `API 返回错误 (${current.code})`);
    }
    if (current.data !== undefined) current = current.data;
    else break;
  }
  return current;
}

function readList(value) {
  const data = unwrap(value);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.list)) return data.list;
  if (data && Array.isArray(data.funds)) return data.funds;
  return [];
}

function normalizeRows(holdings, fundInfo) {
  const infoById = new Map();
  for (const info of fundInfo) {
    if (info && info.fund_id !== undefined) infoById.set(String(info.fund_id), info);
  }
  return holdings.map((holding) => {
    const id = holding.fund_id ?? holding.id;
    const info = infoById.get(String(id)) || {};
    const change = pickNumber(
      info.day_growth_rate,
      info.increase_rate,
      info.increaseRate,
      info.gszzl,
      info.rate,
      holding.day_growth_rate,
      holding.increase_rate,
      holding.gszzl,
    );
    return {
      name: String(info.short_name || info.name || holding.short_name || holding.name || id || '基金'),
      change,
      earn: pickNumber(holding.hold_earn, holding.earn, holding.profit),
    };
  });
}

function makeWidget(rows, updatedAt, state, family) {
  const compact = family === 'systemSmall' || family === 'accessoryRectangular';
  const colors = {
    primary: '#FFFFFF',
    secondary: '#A9AAB5',
    positive: '#FF6B5F',
    negative: '#43C89A',
    neutral: '#E4E5EB',
  };
  const children = [
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      children: [
        text('养基宝', compact ? 'headline' : 'title3', 'bold', colors.primary),
        { type: 'spacer' },
        text(state, 'caption2', 'medium', colors.secondary),
      ],
    },
  ];

  if (!rows.length) {
    children.push({ type: 'spacer' });
    children.push(text(state === '加载中' ? '正在读取持仓…' : '暂无基金持仓', 'subheadline', 'medium', colors.secondary));
  } else {
    const visible = rows.slice(0, compact ? 2 : 4);
    for (const row of visible) {
      const value = row.change !== null
        ? `${formatNumber(row.change, '%')} 估值`
        : row.earn !== null
          ? `${formatNumber(row.earn)} 持有收益`
          : '涨跌暂不可用';
      const valueNumber = row.change ?? row.earn;
      const valueColor = valueNumber === null
        ? colors.secondary
        : valueNumber > 0
          ? colors.positive
          : valueNumber < 0
            ? colors.negative
            : colors.neutral;
      children.push({
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          text(row.name, compact ? 'caption1' : 'subheadline', 'medium', colors.primary),
          { type: 'spacer' },
          text(value, compact ? 'caption2' : 'caption1', 'semibold', valueColor),
        ],
      });
    }
    if (rows.length > visible.length) {
      children.push(text(`另有 ${rows.length - visible.length} 只`, 'caption2', 'regular', colors.secondary));
    }
  }

  children.push({ type: 'spacer' });
  children.push(text(`更新于 ${updatedAt}`, 'caption2', 'regular', colors.secondary));
  return {
    type: 'widget',
    refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    padding: compact ? 10 : 14,
    gap: compact ? 5 : 8,
    backgroundGradient: {
      type: 'linear',
      colors: ['#34364B', '#242638'],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 },
    },
    children,
  };
}

function localTime(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit',
  }).format(date);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function md5(input) {
  const bytes = unescape(encodeURIComponent(input));
  const words = [];
  for (let i = 0; i < bytes.length; i += 1) {
    words[i >> 2] = (words[i >> 2] || 0) | (bytes.charCodeAt(i) << ((i % 4) * 8));
  }
  const bitLength = bytes.length * 8;
  words[bitLength >> 5] = (words[bitLength >> 5] || 0) | (0x80 << (bitLength % 32));
  words[(((bitLength + 64) >>> 9) << 4) + 14] = bitLength;
  const add = (a, b) => (a + b) | 0;
  const rol = (value, shift) => (value << shift) | (value >>> (32 - shift));
  const ff = (a, b, c, d, x, s, t) => add(rol(add(add(a, (b & c) | (~b & d)), add(x, t)), s), b);
  const gg = (a, b, c, d, x, s, t) => add(rol(add(add(a, (b & d) | (c & ~d)), add(x, t)), s), b);
  const hh = (a, b, c, d, x, s, t) => add(rol(add(add(a, b ^ c ^ d), add(x, t)), s), b);
  const ii = (a, b, c, d, x, s, t) => add(rol(add(add(a, c ^ (b | ~d)), add(x, t)), s), b);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let offset = 0; offset < words.length; offset += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    a = ff(a,b,c,d,words[offset+0]||0,7,-680876936); d = ff(d,a,b,c,words[offset+1]||0,12,-389564586); c = ff(c,d,a,b,words[offset+2]||0,17,606105819); b = ff(b,c,d,a,words[offset+3]||0,22,-1044525330);
    a = ff(a,b,c,d,words[offset+4]||0,7,-176418897); d = ff(d,a,b,c,words[offset+5]||0,12,1200080426); c = ff(c,d,a,b,words[offset+6]||0,17,-1473231341); b = ff(b,c,d,a,words[offset+7]||0,22,-45705983);
    a = ff(a,b,c,d,words[offset+8]||0,7,1770035416); d = ff(d,a,b,c,words[offset+9]||0,12,-1958414417); c = ff(c,d,a,b,words[offset+10]||0,17,-42063); b = ff(b,c,d,a,words[offset+11]||0,22,-1990404162);
    a = ff(a,b,c,d,words[offset+12]||0,7,1804603682); d = ff(d,a,b,c,words[offset+13]||0,12,-40341101); c = ff(c,d,a,b,words[offset+14]||0,17,-1502002290); b = ff(b,c,d,a,words[offset+15]||0,22,1236535329);
    a = gg(a,b,c,d,words[offset+1]||0,5,-165796510); d = gg(d,a,b,c,words[offset+6]||0,9,-1069501632); c = gg(c,d,a,b,words[offset+11]||0,14,643717713); b = gg(b,c,d,a,words[offset+0]||0,20,-373897302);
    a = gg(a,b,c,d,words[offset+5]||0,5,-701558691); d = gg(d,a,b,c,words[offset+10]||0,9,38016083); c = gg(c,d,a,b,words[offset+15]||0,14,-660478335); b = gg(b,c,d,a,words[offset+4]||0,20,-405537848);
    a = gg(a,b,c,d,words[offset+9]||0,5,568446438); d = gg(d,a,b,c,words[offset+14]||0,9,-1019803690); c = gg(c,d,a,b,words[offset+3]||0,14,-187363961); b = gg(b,c,d,a,words[offset+8]||0,20,1163531501);
    a = gg(a,b,c,d,words[offset+13]||0,5,-1444681467); d = gg(d,a,b,c,words[offset+2]||0,9,-51403784); c = gg(c,d,a,b,words[offset+7]||0,14,1735328473); b = gg(b,c,d,a,words[offset+12]||0,20,-1926607734);
    a = hh(a,b,c,d,words[offset+5]||0,4,-378558); d = hh(d,a,b,c,words[offset+8]||0,11,-2022574463); c = hh(c,d,a,b,words[offset+11]||0,16,1839030562); b = hh(b,c,d,a,words[offset+14]||0,23,-35309556);
    a = hh(a,b,c,d,words[offset+1]||0,4,-1530992060); d = hh(d,a,b,c,words[offset+4]||0,11,1272893353); c = hh(c,d,a,b,words[offset+7]||0,16,-155497632); b = hh(b,c,d,a,words[offset+10]||0,23,-1094730640);
    a = hh(a,b,c,d,words[offset+13]||0,4,681279174); d = hh(d,a,b,c,words[offset+0]||0,11,-358537222); c = hh(c,d,a,b,words[offset+3]||0,16,-722521979); b = hh(b,c,d,a,words[offset+6]||0,23,76029189);
    a = hh(a,b,c,d,words[offset+9]||0,4,-640364487); d = hh(d,a,b,c,words[offset+12]||0,11,-421815835); c = hh(c,d,a,b,words[offset+15]||0,16,530742520); b = hh(b,c,d,a,words[offset+2]||0,23,-995338651);
    a = ii(a,b,c,d,words[offset+0]||0,6,-198630844); d = ii(d,a,b,c,words[offset+7]||0,10,1126891415); c = ii(c,d,a,b,words[offset+14]||0,15,-1416354905); b = ii(b,c,d,a,words[offset+5]||0,21,-57434055);
    a = ii(a,b,c,d,words[offset+12]||0,6,1700485571); d = ii(d,a,b,c,words[offset+3]||0,10,-1894986606); c = ii(c,d,a,b,words[offset+10]||0,15,-1051523); b = ii(b,c,d,a,words[offset+1]||0,21,-2054922799);
    a = ii(a,b,c,d,words[offset+8]||0,6,1873313359); d = ii(d,a,b,c,words[offset+15]||0,10,-30611744); c = ii(c,d,a,b,words[offset+6]||0,15,-1560198380); b = ii(b,c,d,a,words[offset+13]||0,21,1309151649);
    a = ii(a,b,c,d,words[offset+4]||0,6,-145523070); d = ii(d,a,b,c,words[offset+11]||0,10,-1120210379); c = ii(c,d,a,b,words[offset+2]||0,15,718787259); b = ii(b,c,d,a,words[offset+9]||0,21,-343485551);
    a0 = add(a0, a); b0 = add(b0, b); c0 = add(c0, c); d0 = add(d0, d);
  }
  const hex = (value) => {
    let output = '';
    for (let i = 0; i < 4; i += 1) {
      output += (`0${((value >> (i * 8)) & 0xff).toString(16)}`).slice(-2);
    }
    return output;
  };
  return `${hex(a0)}${hex(b0)}${hex(c0)}${hex(d0)}`;
}

function buildSignature(base, path, token, secret, timestamp, api) {
  const pathOnly = path.split('?')[0];
  const source = api === 'old'
    ? `${pathOnly}${token}${timestamp}${secret}`
    : `${base}${pathOnly}${token}${secret}${timestamp}`;
  return md5(source);
}

async function request(ctx, { base, path, token, secret, api, method = 'GET', body, policy }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = {
    'Request-Time': String(timestamp),
    'Request-Sign': buildSignature(base, path, token, secret, timestamp, api),
    Authorization: api === 'new' ? `ios:${token}` : token,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const options = { headers, timeout: 12000 };
  if (policy) options.policy = policy;
  if (body) options.body = body;
  const response = method === 'POST'
    ? await ctx.http.post(`${base}${path}`, options)
    : await ctx.http.get(`${base}${path}`, options);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.status === 401 ? '登录令牌已失效，请重新登录' : `HTTP ${response.status}`);
  }
  try {
    return unwrap(await response.json());
  } catch (_) {
    throw new Error('服务返回的内容无法解析');
  }
}

async function fetchNew(ctx, env) {
  const token = env.YJB_TOKEN;
  const secret = env.YJB_SIGNING_SECRET;
  const base = (env.YJB_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const policy = env.YJB_POLICY || '';
  if (!token || !secret) throw new Error('请在小组件配置中填写 YJB_TOKEN 和 YJB_SIGNING_SECRET');
  let accountId = env.YJB_ACCOUNT_ID;
  if (!accountId) {
    const accountData = await request(ctx, {
      base, path: '/users/v1/user-account', token, secret, api: 'new', policy,
    });
    const accounts = readList(accountData);
    accountId = accounts[0] && accounts[0].id;
    if (!accountId) return [];
  }
  const holdingsData = await request(ctx, {
    base,
    path: `/position/v1/static/fund-accounts/${encodeURIComponent(accountId)}/funds`,
    token, secret, api: 'new', policy,
  });
  const holdings = readList(holdingsData);
  if (!holdings.length) return [];
  const fundIds = holdings.map((holding) => holding.fund_id).filter((id) => id !== undefined && id !== null);
  const fundInfo = fundIds.length
    ? readList(await request(ctx, {
      base,
      path: '/market/v1/fund/batch',
      token,
      secret,
      api: 'new',
      policy,
      method: 'POST',
      body: { funds: fundIds.map((fund_id) => ({ fund_id, data_source: '1' })) },
    }))
    : [];
  return normalizeRows(holdings, fundInfo);
}

async function fetchOld(ctx, env) {
  const token = env.YJB_TOKEN;
  const secret = env.YJB_SIGNING_SECRET;
  const accountId = env.YJB_ACCOUNT_ID;
  if (!token || !secret || !accountId) {
    throw new Error('旧接口需要配置 YJB_TOKEN、YJB_SIGNING_SECRET 和 YJB_ACCOUNT_ID');
  }
  const base = (env.YJB_API_BASE || 'http://browser-plug-api.yangjibao.com').replace(/\/+$/, '');
  const policy = env.YJB_POLICY || '';
  const data = await request(ctx, {
    base,
    path: `/fund_hold?account_id=${encodeURIComponent(accountId)}`,
    token,
    secret,
    api: 'old',
    policy,
  });
  return readList(data).map((holding) => {
    const nav = holding.nv_info || {};
    const change = pickNumber(nav.gszzl, nav.vgszzl, nav.zsgzzl, holding.day_growth_rate);
    return {
      name: String(holding.short_name || holding.name || holding.code || '基金'),
      change,
      earn: pickNumber(holding.hold_earn),
    };
  });
}

export default async function (ctx) {
  const env = ctx.env || {};
  const api = env.YJB_API === 'old' ? 'old' : 'new';
  const family = ctx.widgetFamily || 'systemMedium';
  let rows = [];
  let state = '加载中';
  let updatedAt = '--';
  let cache;

  try {
    cache = await ctx.storage.getJSON(CACHE_KEY);
    const fetchPromise = (api === 'old' ? fetchOld(ctx, env) : fetchNew(ctx, env))
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error }));
    const outcome = await Promise.race([
      fetchPromise,
      delay(6000).then(() => ({ pending: true })),
    ]);
    if (outcome.pending) {
      return makeWidget([], '--', '加载中', family);
    }
    if (!outcome.ok) throw outcome.error;
    const fetched = outcome.value;
    rows = fetched;
    updatedAt = localTime(new Date());
    state = '实时';
    await ctx.storage.setJSON(CACHE_KEY, { rows, updatedAt, savedAt: Date.now() });
  } catch (error) {
    if (cache && Array.isArray(cache.rows) && Date.now() - cache.savedAt < CACHE_TTL_SECONDS * 1000) {
      rows = cache.rows;
      updatedAt = cache.updatedAt || '--';
      state = `缓存 · ${String(error.message || '请求失败').slice(0, 22)}`;
    } else {
      state = String(error.message || '请求失败').slice(0, 28);
    }
  }

  return makeWidget(rows, updatedAt, state, family);
}
