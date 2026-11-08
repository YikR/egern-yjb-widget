const DEFAULT_BASE = 'https://app-api.yangjibao.com';
const CACHE_KEY = 'yjb-fund-widget-cache-v2';
const CACHE_TTL_SECONDS = 60 * 60 * 24;
const OPEN_REFRESH_SECONDS = 60;
const CLOSED_REFRESH_SECONDS = 15 * 60;
const ERROR_REFRESH_SECONDS = 5 * 60;

function text(value, size, weight, color, maxLines = 1, minScale = 0.7) {
  return {
    type: 'text',
    text: String(value),
    font: { size, weight },
    textColor: color,
    maxLines,
    minScale,
  };
}

function formatNumber(value, suffix = '') {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}${suffix}`;
}

function pickNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const normalized = typeof value === 'string'
      ? value.trim().replace(/,/g, '').replace(/[％%]/g, '').replace(/^[¥￥]/, '')
      : value;
    if (Number.isFinite(Number(normalized))) return Number(normalized);
  }
  return null;
}

function pickText(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  }
  return '';
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
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.rows)) return data.rows;
  if (data && Array.isArray(data.fund_list)) return data.fund_list;
  return [];
}

function readObject(value) {
  const data = unwrap(value);
  if (Array.isArray(data)) return data[0] && typeof data[0] === 'object' ? data[0] : {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  for (const key of ['list', 'items', 'rows', 'funds', 'fund_list']) {
    if (Array.isArray(data[key])) return data[key][0] && typeof data[key][0] === 'object' ? data[key][0] : {};
  }
  for (const key of ['quote', 'fund', 'result', 'quote_data', 'fund_data', 'gz_data']) {
    if (data[key] && typeof data[key] === 'object') return readObject(data[key]);
  }
  return data;
}

function parseTimestamp(value, now = new Date()) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
    const number = Number(value);
    const milliseconds = number < 10000000000 ? number * 1000 : number;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (timeOnly) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return new Date(`${dateParts.year}-${dateParts.month}-${dateParts.day}T${timeOnly[1].padStart(2, '0')}:${timeOnly[2]}:${timeOnly[3] || '00'}+08:00`);
  }
  const normalized = raw.replace(/年|\//g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/时/g, ':').replace(/分/g, '');
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized);
  const dateText = normalized.includes('T') || normalized.includes(' ') ? normalized.replace(' ', 'T') : `${normalized}T00:00:00`;
  const date = new Date(hasZone ? dateText : `${dateText}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localTime(date) {
  if (!date || Number.isNaN(new Date(date).getTime())) return '--';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit',
  }).format(new Date(date));
}

function chinaTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function isTradingWindow(date = new Date()) {
  const parts = chinaTimeParts(date);
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return (minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900);
}

function explicitMarketStatus(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value ? '开市' : '休市';
    if (value === undefined || value === null) continue;
    const normalized = String(value).toLowerCase();
    if (/(开市|交易中|trading|open|true|1)/.test(normalized)) return '开市';
    if (/(休市|收市|closed|close|false|0)/.test(normalized)) return '休市';
  }
  return null;
}

function normalizeMarketStatus(...values) {
  return explicitMarketStatus(...values) || (isTradingWindow() ? '开市' : '休市');
}

function colorFor(value, colors) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return colors.secondary;
  return Number(value) > 0 ? colors.positive : Number(value) < 0 ? colors.negative : colors.neutral;
}

function readToggle(env, key, defaultValue = true) {
  if (String(env[key] ?? '').trim() === '0') return false;
  if (String(env[key] ?? '').trim() === '1') return true;
  return defaultValue;
}

function readMaxFields(env) {
  const value = Number.parseInt(String(env.YJB_MAX_FIELDS ?? '2'), 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 2;
}

function displayOptions(env = {}) {
  return {
    showDailyAmount: readToggle(env, 'YJB_SHOW_DAILY_CHANGE_AMOUNT', true),
    showDailyPct: readToggle(env, 'YJB_SHOW_DAILY_CHANGE_PCT', true),
    maxFields: readMaxFields(env),
  };
}

function normalizeRows(holdings, fundInfo, quoteById = new Map()) {
  const infoById = new Map();
  for (const info of fundInfo) {
    if (info && info.fund_id !== undefined) infoById.set(String(info.fund_id), info);
  }
  return holdings.map((holding) => {
    const id = holding.fund_id ?? holding.id;
    const info = infoById.get(String(id)) || {};
    const quote = quoteById.get(String(id)) || {};
    const liveDailyPct = pickNumber(
      quote.gszzl, quote.vgszzl, quote.zsgzzl, quote.increase_rate, quote.increaseRate,
      quote.day_growth_rate, quote.dayGrowthRate, quote.change_percent, quote.changePercent,
      quote.change_rate, quote.changeRate, quote.rate, quote.growth_rate, quote.growthRate,
      quote.rise_rate, quote.riseRate, quote.weighted_increase_rate, quote.average_increase_rate,
      quote.weightedIncreaseRate, quote.averageIncreaseRate, quote.increase, quote.change,
    );
    const publishedDailyPct = pickNumber(
      info.gszzl, info.vgszzl, info.zsgzzl, info.day_growth_rate, info.dayGrowthRate,
      info.increase_rate, info.increaseRate, info.rate, info.change_percent, info.changePercent,
      info.growth_rate, info.growthRate, info.rise_rate, info.riseRate,
      info.change_rate, info.changeRate, info.increase, info.change,
      holding.day_growth_rate, holding.dayGrowthRate, holding.increase_rate, holding.increaseRate,
      holding.gszzl, holding.vgszzl, holding.zsgzzl, holding.change_rate, holding.changeRate,
      holding.rate, holding.growth_rate, holding.growthRate,
    );
    const estimateNav = pickNumber(
      quote.gsz, quote.vgsz, quote.zsgz, quote.estimate_nav, quote.estimated_nav,
      quote.estimateNav, quote.estimatedNav, quote.nav,
      info.gsz, info.vgsz, info.zsgz, info.estimate_nav, info.estimated_nav,
      info.estimateNav, info.estimatedNav,
    );
    const lastNav = pickNumber(
      holding.last_net, holding.last_nav, holding.lastNet, holding.net_value, holding.unit_nav,
      holding.nav, holding.netValue,
      info.last_net, info.last_nav, info.lastNet, info.net_value, info.unit_nav,
      info.nav, info.netValue, info.dwjz, info.unitNetValue, info.latest_nav,
    );
    const derivedPct = publishedDailyPct === null && estimateNav !== null && lastNav !== null && lastNav !== 0
      ? (estimateNav - lastNav) / lastNav * 100
      : null;
    const dailyChangePct = liveDailyPct ?? publishedDailyPct ?? derivedPct;
    const shares = pickNumber(holding.hold_share, holding.shares, holding.share, holding.amount_share);
    const marketValue = pickNumber(
      holding.money, holding.market_value, holding.current_value, holding.total_value,
      holding.marketValue, holding.assets, holding.asset_value,
    ) ?? (shares !== null && (estimateNav ?? lastNav) !== null ? shares * (estimateNav ?? lastNav) : null);
    const quoteDailyChangeAmount = pickNumber(
      quote.estimate_amount, quote.estimated_amount, quote.gsz_change_amount, quote.vgsz_change_amount,
      quote.estimate_profit, quote.estimated_profit, quote.estimateProfit, quote.estimatedProfit,
      quote.increase_amount, quote.increaseAmount, quote.change_amount, quote.changeAmount,
      quote.daily_change_amount, quote.dailyChangeAmount, quote.day_earn, quote.today_earn,
      quote.daily_profit, quote.dailyProfit, quote.today_profit, quote.todayProfit,
      quote.day_income, quote.dayIncome, quote.profit_today, quote.profitToday,
      quote.profit, quote.income, quote.change, quote.today_change, quote.todayChange,
    );
    const supplementalDailyChangeAmount = pickNumber(
      info.estimate_amount, info.estimated_amount, info.increase_amount, info.increaseAmount,
      info.daily_change_amount, info.dailyChangeAmount, info.day_earn, info.today_earn, info.daily_profit,
      holding.estimate_amount, holding.estimated_amount, holding.daily_change_amount,
      holding.dailyChangeAmount, holding.day_earn, holding.today_earn, holding.daily_profit,
      holding.dailyProfit, holding.today_profit, holding.todayProfit, holding.day_income, holding.dayIncome,
      holding.today_change, holding.todayChange,
    );
    const directDailyChangeAmount = quoteDailyChangeAmount ?? supplementalDailyChangeAmount;
    const dailyChangeAmount = directDailyChangeAmount !== null
      ? directDailyChangeAmount
      : dailyChangePct !== null && marketValue !== null
        ? marketValue * dailyChangePct / 100
        : dailyChangePct !== null && shares !== null && estimateNav !== null && lastNav !== null
          ? shares * (estimateNav - lastNav)
          : null;
    const quoteAt = parseTimestamp(pickText(
      quote.gztime, quote.vgsztime, quote.zsgztime, quote.quote_time, quote.update_time,
      quote.updated_at, quote.timestamp, quote.server_time, info.gztime, info.update_time,
    ));
    return {
      name: String(info.short_name || info.name || holding.short_name || holding.name || id || '基金'),
      id: String(id || ''),
      marketValue,
      estimateNav,
      lastNav,
      dailyChangeAmount,
      dailyChangePct,
      dailyChangeIsLive: liveDailyPct !== null || quoteDailyChangeAmount !== null,
      marketStatus: normalizeMarketStatus(quote.market_status, quote.marketStatus, quote.status, quote.is_open),
      marketStatusExplicit: explicitMarketStatus(quote.market_status, quote.marketStatus, quote.status, quote.is_open) !== null,
      quoteAt: quoteAt ? quoteAt.toISOString() : null,
      quoteAvailable: dailyChangeAmount !== null || dailyChangePct !== null || estimateNav !== null,
    };
  });
}

function dailyChangeValue(row, compact, colors, options) {
  const candidates = [];
  if (options.showDailyAmount) {
    candidates.push({
      key: 'amount',
      text: `当日涨幅金额 ${row.dailyChangeAmount === null ? '--' : formatNumber(row.dailyChangeAmount)}`,
    });
  }
  if (options.showDailyPct) {
    candidates.push({
      key: 'pct',
      text: `当日涨幅 ${row.dailyChangePct === null ? '--' : formatNumber(row.dailyChangePct, '%')}`,
    });
  }
  const fields = candidates.slice(0, options.maxFields);
  return {
    fields,
    dailyChange: fields.length ? fields.map((field) => field.text).join(compact ? ' / ' : '\n') : '当日涨幅字段已关闭',
    dailyChangeColor: colorFor(row.dailyChangeAmount ?? row.dailyChangePct, colors),
    fontSize: compact ? 'caption2' : 'caption1',
  };
}

function latestQuoteTime(rows) {
  return rows.reduce((latest, row) => {
    const time = row.quoteAt ? new Date(row.quoteAt) : null;
    return time && !Number.isNaN(time.getTime()) && (!latest || time > latest) ? time : latest;
  }, null);
}

function normalizeCachedRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    ...row,
    dailyChangeAmount: row.dailyChangeAmount ?? row.estimateAmount ?? null,
    dailyChangePct: row.dailyChangePct ?? row.estimatePct ?? null,
    dailyChangeIsLive: row.dailyChangeIsLive ?? row.estimateIsLive ?? false,
  }));
}

function mergeCachedRows(rows, cachedRows) {
  const normalizedCache = normalizeCachedRows(cachedRows);
  if (!normalizedCache.length) return rows;
  const cachedById = new Map(normalizedCache.filter((row) => row.id).map((row) => [String(row.id), row]));
  const cachedByName = new Map(normalizedCache.map((row) => [String(row.name), row]));
  return rows.map((row) => {
    if (row.dailyChangeIsLive) return row;
    const cached = cachedById.get(String(row.id)) || cachedByName.get(String(row.name));
    if (!cached) return row;
    const cachedDailyChangeAmount = cached.dailyChangeAmount ?? cached.estimateAmount;
    const cachedDailyChangePct = cached.dailyChangePct ?? cached.estimatePct;
    const cachedEstimateNav = cached.estimateNav;
    const cachedLastNav = cached.lastNav;
    const hasCachedValuation = [cachedDailyChangePct, cachedDailyChangeAmount, cachedEstimateNav, cachedLastNav]
      .some((value) => value !== null && value !== undefined && value !== '');
    if (!hasCachedValuation) return row;
    return {
      ...row,
      dailyChangeAmount: cachedDailyChangeAmount ?? row.dailyChangeAmount,
      dailyChangePct: cachedDailyChangePct ?? row.dailyChangePct,
      dailyChangeIsLive: false,
      estimateNav: cachedEstimateNav ?? row.estimateNav,
      lastNav: cachedLastNav ?? row.lastNav,
      quoteAt: cached.quoteAt || row.quoteAt,
    };
  });
}

function resolveMarketStatus(rows) {
  const explicit = rows.filter((row) => row.marketStatusExplicit).map((row) => row.marketStatus);
  if (explicit.includes('开市')) return '开市';
  if (explicit.includes('休市')) return '休市';
  return isTradingWindow() ? '开市' : '休市';
}

function holdingRow(row, family, colors, options) {
  const narrow = family === 'systemSmall' || family === 'accessoryRectangular';
  const lockScreen = family.startsWith('accessory');
  const result = dailyChangeValue(row, narrow || lockScreen, colors, options);

  if (family === 'accessoryInline') {
    return text(`${row.name} ${result.fields.length ? result.fields.map((field) => field.text).join(' / ') : result.dailyChange}`, 'caption2', 'medium', colors.primary, 1);
  }
  if (family === 'accessoryCircular') {
    return text(result.fields.length ? result.fields.map((field) => field.text).join('\n') : result.dailyChange, 'caption2', 'semibold', result.dailyChangeColor, 2);
  }
  if (narrow) {
    const fieldNodes = result.fields.length
      ? result.fields.map((field) => text(field.text, result.fontSize, 'semibold', result.dailyChangeColor, 1))
      : [text(result.dailyChange, result.fontSize, 'semibold', result.dailyChangeColor, 1)];
    return {
      type: 'stack',
      direction: 'column',
      alignItems: 'start',
      gap: 1,
      children: [
        text(row.name, 'caption1', 'medium', colors.primary, 1),
        ...fieldNodes,
      ],
    };
  }

  const fieldNodes = result.fields.length
    ? result.fields.map((field) => text(field.text, result.fontSize, 'semibold', result.dailyChangeColor, 1))
    : [text(result.dailyChange, result.fontSize, 'semibold', result.dailyChangeColor, 1)];
  return {
    type: 'stack',
    direction: 'column',
    alignItems: 'start',
    gap: 1,
    children: [
      text(row.name, 'subheadline', 'medium', colors.primary, 1),
      ...fieldNodes,
    ],
  };
}

function denseHoldingRow(row, colors, options) {
  const result = dailyChangeValue(row, true, colors, options);
  const detail = result.fields.length ? result.fields.map((field) => field.text).join(' · ') : result.dailyChange;
  const name = text(row.name, 'caption2', 'medium', colors.primary, 1, 0.45);
  name.flex = 1;
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 4,
    children: [
      name,
      text(detail, 'caption2', 'regular', result.dailyChangeColor, 1, 0.45),
    ],
  };
}

function makeWidget(rows, updatedAt, state, marketStatus, refreshSeconds, family, options) {
  const compact = family === 'systemSmall' || family === 'accessoryRectangular';
  const lockScreen = family.startsWith('accessory');
  const statusLabel = marketStatus === '开市' ? '开市' : '休市（最后有效）';
  const denseLayout = !lockScreen && (
    family === 'systemLarge'
    || family === 'systemExtraLarge'
    || (family === 'systemMedium' && rows.length > 3)
  );
  const colors = {
    primary: '#FFFFFF',
    secondary: '#A9AAB5',
    positive: '#FF6B5F',
    negative: '#43C89A',
    neutral: '#E4E5EB',
  };
  if (family === 'accessoryInline') {
    const row = rows[0];
    const value = row ? holdingRow(row, family, colors, options).text : state;
    return {
      type: 'widget',
      refreshAfter: new Date(Date.now() + refreshSeconds * 1000).toISOString(),
      children: [text(`养基宝 · ${statusLabel} · ${value}`, 'caption2', 'medium', colors.primary, 1)],
    };
  }

  const children = [
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      children: [
        text('养基宝', lockScreen ? 'caption1' : compact ? 'headline' : 'title3', 'bold', colors.primary),
        { type: 'spacer' },
        text(statusLabel, 'caption2', 'medium', marketStatus === '开市' ? colors.positive : colors.secondary, 1),
      ],
    },
  ];

  if (!rows.length) {
    children.push({ type: 'spacer' });
    const emptyMessage = state === '加载中' ? '正在读取持仓…' : state === '实时' ? '暂无基金持仓' : state;
    children.push(text(emptyMessage, 'subheadline', 'medium', colors.secondary, 2));
  } else {
    const visible = denseLayout
      ? rows
      : rows.slice(0, family === 'systemSmall' ? 1 : compact ? 1 : 2);
    for (const row of visible) {
      children.push(denseLayout ? denseHoldingRow(row, colors, options) : holdingRow(row, family, colors, options));
    }
    if (!denseLayout && rows.length > visible.length) {
      children.push(text(`另有 ${rows.length - visible.length} 只`, 'caption2', 'regular', colors.secondary));
    }
  }

  if (!lockScreen) {
    children.push({ type: 'spacer' });
    children.push(text(`字段上限 ${options.maxFields} · ${marketStatus === '开市' ? '涨幅更新' : '最后有效涨幅'} ${updatedAt}`, 'caption2', 'regular', colors.secondary, 1));
  }
  return {
    type: 'widget',
    refreshAfter: new Date(Date.now() + refreshSeconds * 1000).toISOString(),
    padding: lockScreen ? 4 : compact ? 10 : 14,
    gap: lockScreen ? 2 : compact ? 5 : denseLayout ? 3 : 8,
    backgroundGradient: {
      type: 'linear',
      colors: ['#34364B', '#242638'],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 },
    },
    children,
  };
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

async function requestQuote(ctx, options) {
  try {
    return readObject(await request(ctx, options));
  } catch (_) {
    return {};
  }
}

async function fetchNewQuotes(ctx, { base, token, secret, policy, fundIds }) {
  const pairs = await Promise.all(fundIds.map(async (fundId) => {
    const estimate = await requestQuote(ctx, {
      base,
      path: `/market/v1/fund/gz-data?fund_id=${encodeURIComponent(fundId)}&source=1`,
      token, secret, api: 'new', policy,
    });
    const hasDailyValue = pickNumber(
      estimate.gszzl, estimate.vgszzl, estimate.zsgzzl, estimate.increase_rate,
      estimate.increaseRate, estimate.day_growth_rate, estimate.dayGrowthRate,
      estimate.change_rate, estimate.changeRate, estimate.rate, estimate.change,
      estimate.weighted_increase_rate, estimate.average_increase_rate,
      estimate.weightedIncreaseRate, estimate.averageIncreaseRate,
      estimate.estimate_amount,
      estimate.estimated_amount, estimate.gsz_change_amount, estimate.daily_change_amount,
      estimate.dailyChangeAmount, estimate.day_earn, estimate.today_earn, estimate.daily_profit,
      estimate.dailyProfit, estimate.today_profit, estimate.todayProfit, estimate.today_change,
      estimate.todayChange,
    ) !== null;
    if (hasDailyValue) return [String(fundId), estimate];
    const rate = await requestQuote(ctx, {
      base,
      path: `/market/v1/fund/increase-rate?fund_id=${encodeURIComponent(fundId)}`,
      token, secret, api: 'new', policy,
    });
    return [String(fundId), { ...rate, ...estimate }];
  }));
  return new Map(pairs);
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
    if (!accountId) return { rows: [], marketStatus: isTradingWindow() ? '开市' : '休市' };
  }
  const holdingsData = await request(ctx, {
    base,
    path: `/position/v1/static/fund-accounts/${encodeURIComponent(accountId)}/funds`,
    token, secret, api: 'new', policy,
  });
  const holdings = readList(holdingsData);
  if (!holdings.length) return { rows: [], marketStatus: isTradingWindow() ? '开市' : '休市' };
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
  const quoteById = fundIds.length
    ? await fetchNewQuotes(ctx, { base, token, secret, policy, fundIds })
    : new Map();
  const rows = normalizeRows(holdings, fundInfo, quoteById);
  return { rows, marketStatus: resolveMarketStatus(rows) };
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
  const rows = readList(data).map((holding) => {
    const nav = holding.nv_info || {};
    const dailyChangePct = pickNumber(nav.gszzl, nav.vgszzl, nav.zsgzzl, holding.day_growth_rate);
    const estimateNav = pickNumber(nav.gsz, nav.vgsz, nav.zsgz);
    const lastNav = pickNumber(holding.last_net, holding.last_nav);
    const shares = pickNumber(holding.hold_share, holding.shares);
    const marketValue = pickNumber(holding.money, holding.market_value);
    const dailyChangeAmount = dailyChangePct !== null && marketValue !== null
      ? marketValue * dailyChangePct / 100
      : dailyChangePct !== null && shares !== null && estimateNav !== null && lastNav !== null
        ? shares * (estimateNav - lastNav)
        : null;
    const explicitStatus = explicitMarketStatus(nav.market_status, nav.marketStatus, nav.status, nav.is_open);
    const quoteAt = parseTimestamp(pickText(nav.gztime, nav.vgsztime, nav.zsgztime, nav.update_time, nav.updated_at));
    return {
      name: String(holding.short_name || holding.name || holding.code || '基金'),
      dailyChangeAmount,
      dailyChangePct,
      dailyChangeIsLive: true,
      marketStatus: explicitStatus || (isTradingWindow() ? '开市' : '休市'),
      marketStatusExplicit: explicitStatus !== null,
      quoteAt: quoteAt ? quoteAt.toISOString() : null,
    };
  });
  return { rows, marketStatus: resolveMarketStatus(rows) };
}

export default async function (ctx) {
  const env = ctx.env || {};
  const api = env.YJB_API === 'old' ? 'old' : 'new';
  const family = ctx.widgetFamily || 'systemMedium';
  const options = displayOptions(env);
  let rows = [];
  let state = '加载中';
  let updatedAt = '--';
  let marketStatus = isTradingWindow() ? '开市' : '休市';
  let refreshSeconds = marketStatus === '开市' ? OPEN_REFRESH_SECONDS : CLOSED_REFRESH_SECONDS;
  let cache;

  try {
    cache = await ctx.storage.getJSON(CACHE_KEY);
    const fetchPromise = (api === 'old' ? fetchOld(ctx, env) : fetchNew(ctx, env))
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error }));
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ pending: true }), 12000);
    });
    const outcome = await Promise.race([fetchPromise, timeoutPromise]);
    clearTimeout(timeoutId);
    if (outcome.pending) {
      if (cache && Array.isArray(cache.rows) && Date.now() - cache.savedAt < CACHE_TTL_SECONDS * 1000) {
        const cachedRows = normalizeCachedRows(cache.rows);
        const cachedStatus = cache.marketStatus || resolveMarketStatus(cachedRows);
        return makeWidget(cachedRows, cache.updatedAt || '--', '缓存', cachedStatus, cachedStatus === '开市' ? OPEN_REFRESH_SECONDS : ERROR_REFRESH_SECONDS, family, options);
      }
      return makeWidget([], '--', '加载中', marketStatus, ERROR_REFRESH_SECONDS, family, options);
    }
    if (!outcome.ok) throw outcome.error;
    const fetched = outcome.value;
    const fetchedRows = Array.isArray(fetched) ? fetched : fetched.rows || [];
    rows = mergeCachedRows(fetchedRows, cache && cache.rows);
    marketStatus = Array.isArray(fetched) ? resolveMarketStatus(rows) : fetched.marketStatus || resolveMarketStatus(rows);
    const latest = latestQuoteTime(rows);
    updatedAt = localTime(latest || new Date());
    state = '实时';
    refreshSeconds = marketStatus === '开市' ? OPEN_REFRESH_SECONDS : CLOSED_REFRESH_SECONDS;
    await ctx.storage.setJSON(CACHE_KEY, { rows, marketStatus, updatedAt, savedAt: Date.now() });
  } catch (error) {
    if (cache && Array.isArray(cache.rows) && Date.now() - cache.savedAt < CACHE_TTL_SECONDS * 1000) {
      rows = normalizeCachedRows(cache.rows);
      updatedAt = cache.updatedAt || '--';
      marketStatus = cache.marketStatus || resolveMarketStatus(rows);
      state = `缓存 · ${String(error.message || '请求失败').slice(0, 22)}`;
    } else {
      state = String(error.message || '请求失败').slice(0, 28);
    }
    refreshSeconds = marketStatus === '开市' ? OPEN_REFRESH_SECONDS : ERROR_REFRESH_SECONDS;
  }

  return makeWidget(rows, updatedAt, state, marketStatus, refreshSeconds, family, options);
}
