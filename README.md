# Egern 养基宝持仓小组件

此仓库提供一个 Egern 远程模块，在桌面或锁屏小组件中显示基金名称、当日涨幅金额、当日涨幅、开市/休市状态和更新时间。开市时脚本每次运行都会请求养基宝行情，并将下一次刷新安排在约 60 秒后；组件会明确标注“实时”“部分实时”“数据延迟”或“更新失败”。休市时显示“休市 · 最后成功”和最后一次成功更新时间。iOS/Egern 的小组件调度仍可能延迟实际刷新，不能保证秒级更新。

## 远程安装

在 Egern 中打开“工具 → 模块”，点“+”并填写：

- 名称：`养基宝基金持仓`（可选）
- 文件位置：远程
- URL：`https://raw.githubusercontent.com/YikR/egern-yjb-widget/main/egern-yjb-widget-module.yaml?v=20261109-4`
- 更新间隔：留空使用 Egern 默认的 86400 秒，或自行设置
- 启用：打开

保存后编辑该模块，在“环境变量”中填写 `YJB_TOKEN`。新接口所需的固定 `YJB_SIGNING_SECRET` 已放在模块内，不需要手动填写；`YJB_ACCOUNT_ID` 和 `YJB_POLICY` 为可选项。账户 ID 留空时使用第一个基金账户，策略组留空时走 Egern 默认策略。模块文件声明的环境变量会由 Egern 自动生成输入项。

显示字段可通过模块环境变量控制：`YJB_SHOW_DAILY_CHANGE_AMOUNT` 和 `YJB_SHOW_DAILY_CHANGE_PCT` 使用 `0`/`1` 分别关闭或开启当日涨幅金额、当日涨幅百分比；`YJB_MAX_FIELDS` 设置每只基金最多显示的涨幅字段数，范围为 `0`–`2`，不含基金名称，默认 `2`。组件底部会显示当前生效的“字段上限 N”。例如只显示涨幅百分比可设置金额为 `0`、百分比为 `1`、字段上限为 `1`。

如果你之前安装过旧版本模块，并在 Env 中保存过 `YJB_SIGNING_SECRET`，请删除这个模块级环境变量后再刷新模块。Egern 的模块级 Env 优先级高于模块内小组件 Env，旧的空值可能覆盖模块内置签名常量。

添加模块后，打开 Egern 的小组件图库，在“模块小组件”中找到“养基宝持仓”并添加到主屏幕或锁屏。模块里的脚本会通过同仓库的 GitHub Raw 地址加载：
`https://raw.githubusercontent.com/YikR/egern-yjb-widget/main/yjb-fund-widget.js`

如果已经安装过旧模块，请在模块详情中执行一次刷新/重新保存；无法立即刷新时可删除旧模块后用上面的远程模块配置重新添加。模块脚本 URL 带有版本参数，用于避免 Egern 或网络缓存继续使用旧脚本。

## 凭据与认证

默认使用 HTTPS App API `https://app-api.yangjibao.com`。脚本从 Egern 模块环境读取 Token 和签名密钥，按接口要求生成请求签名；仓库文件不包含账户凭据。脚本不会执行登录，也不会收集手机号或验证码。令牌失效后，在本机更新 Egern 模块 Env 中的 Token。

模块内置的是新 App API 使用的固定签名常量；你的个人 `YJB_TOKEN` 仍只保存在 Egern 本机模块 Env。若接口未来更换签名常量，只需更新模块版本。若要让数据请求经指定策略组发出，可设置 `YJB_POLICY` 为现有策略组名称。

## 获取 YJB_TOKEN

Token 需要通过养基宝 API 工具使用手机号验证码登录获取。请在本机执行：

```bash
git clone https://github.com/Ye-Yu-Mo/yjb-api.git
cd yjb-api
python3 -m pip install requests
python3 yjb_tool.py --sms-login 你的手机号
```

输入短信验证码后，工具会将 Token 保存到 `~/.yjb_token.json`。文件中的 `token` 是要填入 Egern 的值；`timestamp` 只是保存时间记录，不需要填写。可以在本机复制 Token 到剪贴板：

```bash
python3 -c 'import json, pathlib; print(json.loads(pathlib.Path.home().joinpath(".yjb_token.json").read_text())["token"], end="")' | pbcopy
```

然后在 Egern 模块 Env 中粘贴为 `YJB_TOKEN`。不要将该文件、Token 或手机号提交到 GitHub，也不要发送到聊天中。

## 请求与认证

默认使用 `https://app-api.yangjibao.com`。每个请求都使用 Token、模块内置的签名常量和当前 Unix 时间戳计算 `Request-Sign`，并发送 `Authorization: ios:<token>`、`Request-Time`、`Request-Sign`。如你在本机部署了兼容网关，可用 `YJB_API_BASE` 改为该地址；网关仍需按 API 文档验证签名。脚本不会执行登录，也不会收集手机号或验证码。令牌失效时，重新运行短信登录并更新本地环境中的 `YJB_TOKEN`。

脚本默认使用 HTTPS 新接口，并优先请求轻量的 `increase-rate` 行情接口，再按需回退到估值接口；代码保留旧接口兼容分支，但旧接口基于 HTTP，不建议启用。

## 状态与限制

- 尚未配置凭据或请求报错：显示具体的配置/请求状态；网络请求超过 12 秒仍未完成时显示“加载中”；若 24 小时内有成功缓存则显示缓存，并标出缓存数据。
- 空账户或无持仓：显示“暂无基金持仓”。
- 每只基金显示可配置的“当日涨幅金额”和“当日涨幅百分比”。金额优先使用行情接口提供的当日涨幅金额，否则按持仓市值与当日涨幅计算；不再展示持有收益或持仓比例。
- 当两个涨幅字段都关闭，组件会显示“当日涨幅字段已关闭”，同时保留字段上限标记。
- 开市时右上角会显示“开市 · 实时”“开市 · 部分实时”“开市 · 数据延迟”或“开市 · 更新失败”；底部显示本次成功请求时间或最后成功时间。休市时显示“休市 · 最后成功”，不会把休市数据标成实时。
- 行情补充按基金逐项读取，但使用最多 3 个并发请求，并对空响应、超时和临时限流自动重试；组件优先读取 `increase-rate` 的 `weighted_increase_rate` 或 `average_increase_rate`，再按需回退到估值、基金概览，最后用历史净值计算最近两日涨幅。这样可以避免一次同时请求多只基金时只成功一部分。若所有接口都没有返回可计算的字段，该基金仍会显示 `--`，不会把缺失数据伪装成实时值。
- 所有可用持仓都会保留在数据模型中。大号、超大号和持仓较多的中号组件使用紧凑列表展示全部基金；小号和锁屏组件受系统可用面积限制，显示首只基金及“另有 N 只”摘要。
- 市场状态按养基宝返回的状态字段优先，缺少状态字段时按中国大陆工作日 09:30–11:30、13:00–15:00 的交易时段判断。该时段规则无法单独识别临时休市或节假日；若接口返回明确状态则以接口为准。
- 小组件刷新由 iOS/Egern 系统调度控制；脚本设置的 60 秒只是开市时的最早刷新请求时间，不代表系统一定每 60 秒执行。

## 本地配置安装

如果不使用模块管理，可将 `yjb-fund-widget.js` 放在配置文件旁边，并将 `yjb-widget-config.yaml` 中的 `scriptings` 与 `widgets` 两项合并到 Egern 配置。不要同时安装本地条目和远程模块，否则可能产生同名小组件。

## 验证与限制

基金接口字段可能变化。脚本优先读取 `/market/v1/fund/increase-rate` 的实时涨幅字段，必要时回退到 `/market/v1/fund/gz-data`、`/market/v1/fund/overview`，或用 `/market/v1/fund-nav/fund-history-nav` 的最近两条净值计算涨幅；金额优先使用接口返回的当日涨幅金额，否则按持仓市值与当日涨幅计算。行情请求采用限并发与短重试，减少部分基金因接口超时或临时限流而显示空值的情况。组件刷新由 iOS/Egern 系统调度控制。真实账户端到端验证只需要在 Egern 本机填写有效 Token。
