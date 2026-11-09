const DEFAULT_BASE = 'https://app-api.yangjibao.com';
const CACHE_KEY = 'yjb-fund-widget-cache-v2';
const CACHE_TTL_SECONDS = 60 * 60 * 24;
const OPEN_REFRESH_SECONDS = 60;
const CLOSED_REFRESH_SECONDS = 15 * 60;
const ERROR_REFRESH_SECONDS = 5 * 60;
const QUOTE_CONCURRENCY = 3;
const QUOTE_ATTEMPTS = 2;
const QUOTE_RETRY_DELAY_MS = 180;
const HTTP_TIMEOUT_MS = 6000;
const FETCH_DEADLINE_MS = 16000;
const QUOTE_STALE_AFTER_SECONDS = 10 * 60;

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
  if (data && data.result && (Array.isArray(data.result) || typeof data.result === 'object')) {
    const result = readList(data.result);
    if (result.length) return result;
  }
  if (data && typeof data === 'object') {
    const values = Object.values(data);
    const objectValues = values.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (objectValues.length && objectValues.some((item) => fundIdOf(item) !== null)) {
      return objectValues;
    }
  }
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

function fundIdOf(value) {
  if (!value || typeof value !== 'object') return null;
  return value.fund_id ?? value.fundId ?? value.fund_code ?? value.fundCode
    ?? value.id ?? value.code ?? null;
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
    const normalized = String(value).trim().toLowerCase();
    if (['开市', '交易中', 'trading', 'open', 'true', '1'].includes(normalized)
      || /^(开市|交易中|trading|open)(?:[ _-]|$)/.test(normalized)) return '开市';
    if (['休市', '收市', 'closed', 'close', 'false', '0'].includes(normalized)
      || /^(休市|收市|closed|close)(?:[ _-]|$)/.test(normalized)) return '休市';
  }
  return null;
}

function normalizeMarketStatus(...values) {
  return explicitMarketStatus(...values) || (isTradingWindow() ? '开市' : '休市');
}

function quoteIsFresh(quoteAt, now = Date.now()) {
  if (!quoteAt) return true;
  // Outside the configured mainland trading windows, a quote from the same
  // session is a valid last market value rather than a live quote that should
  // be aged out. The closed-state renderer marks it red separately.
  if (!isTradingWindow(new Date(now))) return true;
  const timestamp = new Date(quoteAt).getTime();
  if (!Number.isFinite(timestamp)) return true;
  const age = now - timestamp;
  return age < 0 || age <= QUOTE_STALE_AFTER_SECONDS * 1000;
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
    const id = fundIdOf(info);
    if (id !== null && id !== undefined) infoById.set(String(id), info);
  }
  return holdings.map((holding) => {
    const id = fundIdOf(holding);
    const info = infoById.get(String(id)) || {};
    const quote = quoteById.get(String(id)) || {};
    const quoteSource = quote._quoteSource || 'unknown';
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
      info.weighted_increase_rate, info.average_increase_rate,
      info.weightedIncreaseRate, info.averageIncreaseRate,
      holding.day_growth_rate, holding.dayGrowthRate, holding.increase_rate, holding.increaseRate,
      holding.gszzl, holding.vgszzl, holding.zsgzzl, holding.change_rate, holding.changeRate,
      holding.rate, holding.growth_rate, holding.growthRate, holding.weighted_increase_rate,
      holding.average_increase_rate, holding.weightedIncreaseRate, holding.averageIncreaseRate,
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
      quote.updated_at, quote.timestamp, quote.server_time, quote.serverTime,
      info.gztime, info.update_time, info.updated_at, info.timestamp, info.server_time,
    ));
    const sourceIsLive = (quoteSource === 'realtime' || quoteSource === 'estimate')
      && (liveDailyPct !== null || quoteDailyChangeAmount !== null);
    const fresh = quoteIsFresh(quoteAt);
    return {
      name: String(info.short_name || info.name || info.fund_name || info.fundName
        || holding.short_name || holding.name || holding.fund_name || holding.fundName || id || '基金'),
      id: String(id || ''),
      marketValue,
      estimateNav,
      lastNav,
      dailyChangeAmount,
      dailyChangePct,
      dailyChangeIsLive: sourceIsLive && fresh,
      dailyChangeSource: sourceIsLive && !fresh ? 'stale' : quoteSource,
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

function displayUpdateTime(updatedAt, rows, dataStatus) {
  if (dataStatus === 'live' || dataStatus === 'partial') {
    const quoteTime = latestQuoteTime(rows);
    if (quoteTime) return localTime(quoteTime);
  }
  return updatedAt;
}

function normalizeCachedRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    ...row,
    dailyChangeAmount: row.dailyChangeAmount ?? row.estimateAmount ?? null,
    dailyChangePct: row.dailyChangePct ?? row.estimatePct ?? null,
    dailyChangeIsLive: row.dailyChangeIsLive ?? row.estimateIsLive ?? false,
    dailyChangeSource: row.dailyChangeSource || (row.dailyChangeIsLive ? 'realtime' : 'cache'),
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
      dailyChangeSource: cached.dailyChangeSource || 'cache',
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

function explicitStatusFromRecords(records) {
  const statuses = records
    .flatMap((record) => {
      if (!record || typeof record !== 'object') return [];
      return [explicitMarketStatus(
        record.market_status,
        record.marketStatus,
        record.status,
        record.is_open,
        record.isOpen,
      )];
    })
    .filter(Boolean);
  if (statuses.includes('开市')) return '开市';
  if (statuses.includes('休市')) return '休市';
  return null;
}

function liveRowCount(rows) {
  return rows.filter((row) => row.dailyChangeIsLive === true).length;
}

function resolveDataStatus(rows, marketStatus, requestState) {
  if (requestState === 'loading') return 'loading';
  if (marketStatus !== '开市') return 'closed';
  if (requestState === 'error') return 'error';
  if (!rows.length) return 'empty';
  const liveCount = liveRowCount(rows);
  if (liveCount === rows.length) return 'live';
  if (liveCount > 0) return 'partial';
  return 'delayed';
}

function statusLabelFor(marketStatus, dataStatus) {
  if (dataStatus === 'loading') return '加载中';
  if (dataStatus === 'error') return marketStatus === '开市' ? '开市 · 更新失败' : '休市 · 更新失败';
  if (dataStatus === 'live') return '开市 · 实时';
  if (dataStatus === 'partial') return '开市 · 部分实时';
  if (dataStatus === 'delayed') return '开市 · 数据延迟';
  if (dataStatus === 'empty') return marketStatus === '开市' ? '开市 · 无持仓' : '休市 · 无持仓';
  if (dataStatus === 'closed') return '休市 · 最后成功';
  return marketStatus === '开市' ? '开市 · 未更新' : '休市 · 未更新';
}

function freshnessText(marketStatus, dataStatus, updatedAt, rows) {
  const time = updatedAt && updatedAt !== '--' ? updatedAt : '暂无';
  const liveCount = liveRowCount(rows);
  if (dataStatus === 'live') return `实时 · 更新于 ${time}`;
  if (dataStatus === 'partial') return `部分实时 ${liveCount}/${rows.length} · 最后成功 ${time}`;
  if (dataStatus === 'delayed') return `数据延迟 · 最后成功 ${time}`;
  if (dataStatus === 'error') return `更新失败 · 最后成功 ${time}`;
  if (dataStatus === 'loading') return '加载中 · 等待首次成功更新';
  if (dataStatus === 'closed') return `休市 · 最后成功 ${time}`;
  if (dataStatus === 'empty') return `无持仓 · 最近请求 ${time}`;
  return `${marketStatus} · 最后成功 ${time}`;
}

function statusDotColor(row, liveWindow = true) {
  if (liveWindow && row.dailyChangeIsLive === true) return '#43C89A';
  const hasValue = [row.dailyChangeAmount, row.dailyChangePct, row.estimateNav, row.lastNav]
    .some((value) => value !== null && value !== undefined && value !== '');
  return hasValue ? '#FF5B5B' : '#A9AAB5';
}

function fundNameNode(row, size, weight, colors, maxLines = 1, minScale = 0.7, liveWindow = true) {
  const name = text(row.name, size, weight, colors.primary, maxLines, minScale);
  name.flex = 1;
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 2,
    children: [
      text('●', 'caption2', 'bold', statusDotColor(row, liveWindow), 1, 1),
      name,
    ],
  };
}

function aggregateDailyAmount(rows) {
  const values = rows
    .map((row) => Number(row.dailyChangeAmount))
    .filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function headerAmountNode(rows, dataStatus, colors) {
  const sourceRows = dataStatus === 'partial'
    ? rows.filter((row) => row.dailyChangeIsLive === true)
    : rows;
  const amount = aggregateDailyAmount(sourceRows);
  if (amount === null) return null;
  const live = dataStatus === 'live';
  const partial = dataStatus === 'partial';
  const label = live ? '当日涨幅金额' : partial ? '实时涨幅金额' : '最后有效涨幅金额';
  const color = live || partial ? colorFor(amount, colors) : colors.secondary;
  return text(`${label} ${formatNumber(amount)}`, 'caption1', 'medium', color, 1, 0.45);
}

function holdingRow(row, family, colors, options, liveWindow = true) {
  const narrow = family === 'systemSmall' || family === 'accessoryRectangular';
  const lockScreen = family.startsWith('accessory');
  const result = dailyChangeValue(row, narrow || lockScreen, colors, options);

  if (family === 'accessoryInline') {
    return text(`● ${row.name} ${result.fields.length ? result.fields.map((field) => field.text).join(' / ') : result.dailyChange}`, 'caption2', 'medium', statusDotColor(row, liveWindow), 1);
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
        fundNameNode(row, 'caption1', 'medium', colors, 1, 0.6, liveWindow),
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
      fundNameNode(row, 'subheadline', 'medium', colors, 1, 0.6, liveWindow),
      ...fieldNodes,
    ],
  };
}

function denseHoldingRow(row, colors, options, liveWindow = true) {
  const result = dailyChangeValue(row, true, colors, options);
  const detail = result.fields.length ? result.fields.map((field) => field.text).join(' · ') : result.dailyChange;
  const name = fundNameNode(row, 'caption2', 'medium', colors, 1, 0.45, liveWindow);
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

function makeWidget(rows, updatedAt, state, marketStatus, refreshSeconds, family, options, dataStatus = null) {
  const compact = family === 'systemSmall' || family.startsWith('accessory');
  const lockScreen = family.startsWith('accessory');
  const resolvedDataStatus = dataStatus || resolveDataStatus(rows, marketStatus, state === '加载中' ? 'loading' : state === '实时' ? 'success' : 'error');
  const liveWindow = marketStatus === '开市' && (resolvedDataStatus === 'live' || resolvedDataStatus === 'partial');
  const statusLabel = statusLabelFor(marketStatus, resolvedDataStatus);
  const statusColor = resolvedDataStatus === 'live'
    ? '#43C89A'
    : resolvedDataStatus === 'partial'
      ? '#FFB84D'
      : resolvedDataStatus === 'error'
        ? '#FF6B5F'
        : '#A9AAB5';
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
    const value = row ? holdingRow(row, family, colors, options, liveWindow).text : state;
    return {
      type: 'widget',
      refreshAfter: new Date(Date.now() + refreshSeconds * 1000).toISOString(),
      children: [text(`养基宝 · ${statusLabel} · ${value}`, 'caption2', 'medium', colors.primary, 1)],
    };
  }

  const headerAmount = !compact && !lockScreen
    ? headerAmountNode(rows, resolvedDataStatus, colors)
    : null;
  const headerChildren = [
    text('养基宝', lockScreen ? 'caption1' : compact ? 'headline' : 'title3', 'bold', colors.primary),
  ];
  if (headerAmount) headerChildren.push({ type: 'spacer' }, headerAmount);
  headerChildren.push({ type: 'spacer' }, text(statusLabel, 'caption2', 'medium', statusColor, 1));

  const children = [
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      children: headerChildren,
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
      children.push(denseLayout
        ? denseHoldingRow(row, colors, options, liveWindow)
        : holdingRow(row, family, colors, options, liveWindow));
    }
    if (!denseLayout && rows.length > visible.length) {
      children.push(text(`另有 ${rows.length - visible.length} 只`, 'caption2', 'regular', colors.secondary));
    }
  }

  if (!lockScreen) {
    children.push({ type: 'spacer' });
    children.push(text(
      freshnessText(marketStatus, resolvedDataStatus, displayUpdateTime(updatedAt, rows, resolvedDataStatus), rows),
      'caption2',
      'regular',
      colors.secondary,
      1,
    ));
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
    Accept: api === 'new' ? '*/*' : 'application/json',
  };
  if (api === 'new') {
    headers['Accept-Language'] = 'zh-Hans-CN;q=1.0, en-CN;q=0.9';
    headers['Accept-Encoding'] = 'gzip, deflate';
    headers['User-Agent'] = 'YJB/2.0.13 (com.xiaoduotou.yjb; build:975; iOS 26.5.0) Alamofire/5.10.2 iPad8,6';
    headers.Cookie = 'cna=1c1bb34ac9014f8ab07e6e9943d98cb9';
  }
  const options = { headers, timeout: HTTP_TIMEOUT_MS };
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

function hasDailyRate(quote = {}) {
  return pickNumber(
    quote.gszzl, quote.vgszzl, quote.zsgzzl, quote.increase_rate, quote.increaseRate,
    quote.day_growth_rate, quote.dayGrowthRate, quote.change_percent, quote.changePercent,
    quote.change_rate, quote.changeRate, quote.rate, quote.growth_rate, quote.growthRate,
    quote.rise_rate, quote.riseRate, quote.weighted_increase_rate, quote.average_increase_rate,
    quote.weightedIncreaseRate, quote.averageIncreaseRate, quote.increase, quote.change,
  ) !== null;
}

function hasDailyAmount(quote = {}) {
  return pickNumber(
    quote.estimate_amount, quote.estimated_amount, quote.gsz_change_amount,
    quote.vgsz_change_amount, quote.estimate_profit, quote.estimated_profit,
    quote.estimateProfit, quote.estimatedProfit, quote.increase_amount,
    quote.increaseAmount, quote.change_amount, quote.changeAmount,
    quote.daily_change_amount, quote.dailyChangeAmount, quote.day_earn,
    quote.today_earn, quote.daily_profit, quote.dailyProfit, quote.today_profit,
    quote.todayProfit, quote.day_income, quote.dayIncome, quote.profit_today,
    quote.profitToday, quote.profit, quote.income, quote.today_change, quote.todayChange,
  ) !== null;
}

function hasUsableQuote(quote = {}) {
  return hasDailyRate(quote) || hasDailyAmount(quote);
}

async function requestQuoteWithRetry(ctx, options, attempts = QUOTE_ATTEMPTS, requireRate = false) {
  let result = {};
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    result = await requestQuote(ctx, options);
    const complete = requireRate ? hasDailyRate(result) : hasUsableQuote(result);
    const usableAmount = requireRate && hasDailyAmount(result);
    if (complete || usableAmount) return result;
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, QUOTE_RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  return result;
}

function historyTimestamp(item) {
  return parseTimestamp(pickText(
    item.date, item.nav_date, item.navDate, item.trade_date, item.tradeDate,
    item.gztime, item.update_time, item.updated_at, item.timestamp, item.sjrq,
  ));
}

function historyNav(item) {
  return pickNumber(
    item.nav, item.unit_nav, item.unit_net, item.unitNetValue, item.net_value,
    item.netValue, item.dwjz, item.latest_nav, item.latestNav, item.value,
  );
}

async function fetchHistoryQuote(ctx, { base, token, secret, policy, fundId }) {
  try {
    const data = await request(ctx, {
      base,
      path: `/market/v1/fund-nav/fund-history-nav?fund_id=${encodeURIComponent(fundId)}`,
      token, secret, api: 'new', policy,
    });
    const history = readList(data)
      .filter((item) => item && typeof item === 'object')
      .sort((a, b) => {
        const at = historyTimestamp(a)?.getTime() || 0;
        const bt = historyTimestamp(b)?.getTime() || 0;
        return bt - at;
      });
    if (!history.length) return {};
    const current = history[0];
    const previous = history.slice(1).find((item) => historyNav(item) !== null);
    const currentNav = historyNav(current);
    const previousNav = previous ? historyNav(previous) : null;
    const dailyRate = hasDailyRate(current)
      ? current
      : currentNav !== null && previousNav !== null && previousNav !== 0
        ? { ...current, day_growth_rate: (currentNav - previousNav) / previousNav * 100 }
        : current;
    return {
      ...dailyRate,
      nav: currentNav,
      last_nav: previousNav,
      update_time: pickText(
        current.update_time, current.updated_at, current.timestamp,
        current.date, current.nav_date, current.trade_date,
      ),
    };
  } catch (_) {
    return {};
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function createQuoteSourceHealth() {
  return {
    misses: new Map(),
    pending: new Map(),
    disabled: new Set(),
  };
}

async function requestQuoteSource(health, sourceKey, runner) {
  if (health.disabled.has(sourceKey)) return {};
  const misses = health.misses.get(sourceKey) || 0;
  const pending = health.pending.get(sourceKey) || 0;
  if (misses + pending >= 3) {
    health.disabled.add(sourceKey);
    return {};
  }
  health.pending.set(sourceKey, pending + 1);
  let result = {};
  try {
    result = await runner();
  } finally {
    const remaining = (health.pending.get(sourceKey) || 1) - 1;
    if (remaining > 0) health.pending.set(sourceKey, remaining);
    else health.pending.delete(sourceKey);
  }
  if (hasUsableQuote(result)) {
    health.misses.delete(sourceKey);
    health.disabled.delete(sourceKey);
    return result;
  }
  const totalMisses = (health.misses.get(sourceKey) || 0) + 1;
  health.misses.set(sourceKey, totalMisses);
  // A source that misses several consecutive funds is probably unavailable.
  // Stop probing it for the rest of this refresh and move to the next source.
  if (totalMisses >= 3) health.disabled.add(sourceKey);
  return {};
}

async function fetchNewQuotes(ctx, { base, token, secret, policy, fundIds }) {
  const uniqueFundIds = [...new Set(fundIds.map((id) => String(id)))];
  const sourceHealth = createQuoteSourceHealth();
  const pairs = await mapWithConcurrency(uniqueFundIds, QUOTE_CONCURRENCY, async (fundId) => {
    // The rate endpoint is the lightest endpoint and contains the fields needed by
    // the widget. Query it first so a slow valuation endpoint cannot starve later funds.
    const rate = await requestQuoteSource(sourceHealth, 'increase-rate', () => requestQuoteWithRetry(ctx, {
      base,
      path: `/market/v1/fund/increase-rate?fund_id=${encodeURIComponent(fundId)}`,
      token, secret, api: 'new', policy,
    }, QUOTE_ATTEMPTS, true));
    if (hasUsableQuote(rate)) return [fundId, { ...rate, _quoteSource: 'realtime' }];

    const estimate = await requestQuoteSource(sourceHealth, 'gz-data', () => requestQuoteWithRetry(ctx, {
      base,
      path: `/market/v1/fund/gz-data?fund_id=${encodeURIComponent(fundId)}&source=1`,
      token, secret, api: 'new', policy,
    }, 1));
    let merged = { ...estimate, ...rate };
    if (!hasUsableQuote(merged)) {
      const overview = await requestQuoteSource(sourceHealth, 'overview', () => requestQuote(ctx, {
        base,
        path: `/market/v1/fund/overview?data_source=1&fund_id=${encodeURIComponent(fundId)}`,
        token, secret, api: 'new', policy,
      }));
      merged = { ...overview, ...merged, _quoteSource: 'overview' };
    }
    if (!hasUsableQuote(merged)) {
      const history = await requestQuoteSource(sourceHealth, 'history', () => fetchHistoryQuote(ctx, {
        base, token, secret, policy, fundId,
      }));
      merged = { ...history, ...merged, _quoteSource: 'history' };
    }
    if (!merged._quoteSource && hasUsableQuote(merged)) merged._quoteSource = 'estimate';
    return [fundId, merged];
  });
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
  const fundIds = [...new Set(holdings
    .map(fundIdOf)
    .filter((id) => id !== undefined && id !== null)
    .map((id) => String(id)))];
  let fundInfo = [];
  if (fundIds.length) {
    try {
      fundInfo = readList(await request(ctx, {
        base,
        path: '/market/v1/fund/batch',
        token,
        secret,
        api: 'new',
        policy,
        method: 'POST',
        body: { funds: fundIds.map((fund_id) => ({ fund_id, data_source: '1' })) },
      }));
    } catch (_) {
      // Fund metadata is supplemental. Keep holdings and let quote fallbacks
      // populate the values when the batch endpoint is unavailable.
      fundInfo = [];
    }
  }
  const explicitStatus = explicitStatusFromRecords([...holdings, ...fundInfo]);
  const quoteById = fundIds.length && explicitStatus !== '休市'
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
    const sourceIsLive = dailyChangePct !== null || dailyChangeAmount !== null;
    const fresh = quoteIsFresh(quoteAt);
    return {
      name: String(holding.short_name || holding.name || holding.code || '基金'),
      dailyChangeAmount,
      dailyChangePct,
      dailyChangeIsLive: sourceIsLive && fresh,
      dailyChangeSource: sourceIsLive && !fresh ? 'stale' : 'realtime',
      marketStatus: explicitStatus || (isTradingWindow() ? '开市' : '休市'),
      marketStatusExplicit: explicitStatus !== null,
      quoteAt: quoteAt ? quoteAt.toISOString() : null,
    };
  });
  return { rows, marketStatus: resolveMarketStatus(rows) };
}

async function readCache(ctx) {
  try {
    const value = await ctx.storage.getJSON(CACHE_KEY);
    return value && typeof value === 'object' ? value : null;
  } catch (_) {
    return null;
  }
}

async function writeCache(ctx, value) {
  try {
    await ctx.storage.setJSON(CACHE_KEY, value);
  } catch (_) {
    // Storage is an optional optimization. A write failure must not turn a
    // successful API response into an error state.
  }
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
  let dataStatus = 'loading';
  let cache;

  try {
    cache = await readCache(ctx);
    const fetchPromise = (api === 'old' ? fetchOld(ctx, env) : fetchNew(ctx, env))
      .then((value) => ({ ok: true, value }))
      .catch((error) => ({ ok: false, error }));
    let timeoutId;
    const timeoutPromise = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ pending: true }), FETCH_DEADLINE_MS);
    });
    const outcome = await Promise.race([fetchPromise, timeoutPromise]);
    clearTimeout(timeoutId);
    if (outcome.pending) {
      if (cache && Array.isArray(cache.rows) && Date.now() - cache.savedAt < CACHE_TTL_SECONDS * 1000) {
        const cachedRows = normalizeCachedRows(cache.rows);
        const cachedStatus = cache.marketStatus || resolveMarketStatus(cachedRows);
        const cachedUpdatedAt = cache.updatedAt || (cache.lastSuccessAt ? localTime(new Date(cache.lastSuccessAt)) : '--');
        return makeWidget(cachedRows, cachedUpdatedAt, '缓存', cachedStatus, cachedStatus === '开市' ? OPEN_REFRESH_SECONDS : ERROR_REFRESH_SECONDS, family, options, resolveDataStatus(cachedRows, cachedStatus, 'error'));
      }
      return makeWidget([], '--', '加载中', marketStatus, ERROR_REFRESH_SECONDS, family, options, 'loading');
    }
    if (!outcome.ok) throw outcome.error;
    const fetched = outcome.value;
    const fetchedRows = Array.isArray(fetched) ? fetched : fetched.rows || [];
    rows = mergeCachedRows(fetchedRows, cache && cache.rows);
    marketStatus = Array.isArray(fetched) ? resolveMarketStatus(rows) : fetched.marketStatus || resolveMarketStatus(rows);
    const lastSuccessAt = Date.now();
    updatedAt = localTime(new Date(lastSuccessAt));
    state = '实时';
    dataStatus = resolveDataStatus(rows, marketStatus, 'success');
    refreshSeconds = marketStatus === '开市' ? OPEN_REFRESH_SECONDS : CLOSED_REFRESH_SECONDS;
    await writeCache(ctx, { rows, marketStatus, updatedAt, lastSuccessAt, savedAt: lastSuccessAt });
  } catch (error) {
    if (cache && Array.isArray(cache.rows) && Date.now() - cache.savedAt < CACHE_TTL_SECONDS * 1000) {
      rows = normalizeCachedRows(cache.rows);
      updatedAt = cache.updatedAt || (cache.lastSuccessAt ? localTime(new Date(cache.lastSuccessAt)) : '--');
      marketStatus = cache.marketStatus || resolveMarketStatus(rows);
      state = `缓存 · ${String(error.message || '请求失败').slice(0, 22)}`;
      dataStatus = resolveDataStatus(rows, marketStatus, 'error');
    } else {
      state = String(error.message || '请求失败').slice(0, 28);
      dataStatus = resolveDataStatus(rows, marketStatus, 'error');
    }
    refreshSeconds = marketStatus === '开市' ? OPEN_REFRESH_SECONDS : ERROR_REFRESH_SECONDS;
  }

  return makeWidget(rows, updatedAt, state, marketStatus, refreshSeconds, family, options, dataStatus);
}
