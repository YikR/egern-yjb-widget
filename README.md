# Egern 养基宝持仓小组件

组件脚本使用养基宝 API 仓库记录的新 App API：先取基金账户列表（除非手动指定账户 ID），再读取该账户持仓，并用批量基金接口补全名称和可用的日涨跌幅字段。收益优先显示估值涨跌幅；接口没有提供该值时回退显示持有收益。Egern 按系统调度刷新，因此“实时”表示每次组件运行时重新请求，不保证秒级刷新。

## 文件

- `yjb-fund-widget.js`：Egern generic 脚本。
- `yjb-widget-config.yaml`：合并到配置中的 `scriptings` 和 `widgets` 条目。

## 配置步骤

1. 将 `yjb-fund-widget.js` 放到 Egern 主配置 `Godx.yaml` 同一目录。当前使用的配置是 iCloud Egern Documents 中的 `Godx.yaml`；本工作区只提供待合并文件，不直接修改该外部配置。
2. 将 `yjb-widget-config.yaml` 中的两条数组项合并到 `Godx.yaml` 的 `scriptings:` 与 `widgets:` 下。不要把顶层 `scriptings:`、`widgets:` 键重复粘贴到已有配置。
3. 在 Egern 的“养基宝持仓”小组件环境中填写 `YJB_TOKEN` 和 `YJB_SIGNING_SECRET`。不要把真实值发到聊天、提交到 Git，或放入脚本源文件。仓库 README 说明新接口 Token 可由手机号验证码登录取得；仓库文档也包含固定签名密钥。该密钥不是用户密码，但属于 API 签名材料，应只保存在本机配置中。
4. `YJB_ACCOUNT_ID` 留空时，脚本读取第一个基金账户；填写账户 ID 可固定读取某个账户。
5. 如需让请求走某个 Egern 策略组，在 `YJB_POLICY` 填入策略组名；留空则使用 Egern 默认请求策略。
6. 保存并让 Egern 重新加载配置，然后在 Egern 的小组件列表添加“养基宝持仓”。中号组件显示最多 4 只，小号/矩形组件显示最多 2 只。

## 请求与认证

默认使用 `https://app-api.yangjibao.com`。每个请求都使用 Token、Unix 时间戳及本地 `YJB_SIGNING_SECRET` 计算 `Request-Sign`，并发送 `Authorization: ios:<token>`、`Request-Time`、`Request-Sign`。如你在本机部署了兼容网关，可用 `YJB_API_BASE` 改为该地址；网关仍需按 API 文档验证签名。脚本不会执行登录，也不会收集手机号或验证码。令牌失效时需在养基宝仓库工具支持的登录流程中重新登录，并把新 Token 更新到本地环境配置。

`YJB_API: old` 可切换至旧接口，但旧接口基于 HTTP；出于凭据传输安全，建议保持默认 HTTPS 新接口。旧接口还必须填写 `YJB_ACCOUNT_ID`。

## 状态与限制

- 尚未配置凭据或请求报错：显示具体的配置/请求状态；网络请求超过 6 秒仍未完成时显示“加载中”；若 24 小时内有成功缓存则显示缓存，并标出“缓存”。
- 空账户或无持仓：显示“暂无基金持仓”。
- 更新时：显示“加载中”状态；成功时显示“实时”和本机更新时间。
- 养基宝接口字段可能变化。批量接口当前没有在仓库 CLI 输出中证明具体的涨跌幅字段，因此脚本尝试常见字段；若接口不返回涨跌幅，会清楚回退到持有收益或显示“涨跌暂不可用”。
- 小组件刷新由 iOS/Egern 系统调度控制，`ctx` API 不保证秒级推送更新。

## 验证

工作区验证包括 JavaScript 语法检查、YAML 解析，以及使用模拟的 Egern HTTP/存储上下文检查成功、空持仓、缺少凭据和缓存回退状态。真实账户端到端验证需要在 Egern 本机填写有效 Token/签名密钥后执行。
