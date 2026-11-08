# Egern 养基宝持仓小组件

此仓库提供一个 Egern 远程模块，在桌面或锁屏小组件中显示基金名称、当日估值涨跌（接口无该字段时回退到持有收益）及更新时间。每次 Egern 刷新小组件时重新请求数据；系统调度不保证秒级实时更新。

## 远程安装

在 Egern 中打开“工具 → 模块”，点“+”并填写：

- 名称：`养基宝基金持仓`（可选）
- 文件位置：远程
- URL：`https://raw.githubusercontent.com/YikR/egern-yjb-widget/main/egern-yjb-widget-module.yaml`
- 更新间隔：留空使用 Egern 默认的 86400 秒，或自行设置
- 启用：打开

保存后编辑该模块，在“环境变量”中填写 `YJB_TOKEN` 和 `YJB_SIGNING_SECRET`。不要把真实值发到聊天或提交到 GitHub。`YJB_ACCOUNT_ID` 和 `YJB_POLICY` 为可选项；账户 ID 留空时使用第一个基金账户，策略组留空时走 Egern 默认策略。模块文件声明的环境变量会由 Egern 自动生成输入项。

添加模块后，打开 Egern 的小组件图库，在“模块小组件”中找到“养基宝持仓”并添加到主屏幕或锁屏。模块里的脚本会通过同仓库的 GitHub Raw 地址加载：
`https://raw.githubusercontent.com/YikR/egern-yjb-widget/main/yjb-fund-widget.js`

## 凭据与认证

默认使用 HTTPS App API `https://app-api.yangjibao.com`。脚本从 Egern 模块环境读取 Token 和签名密钥，按接口要求生成请求签名；仓库文件不包含账户凭据。脚本不会执行登录，也不会收集手机号或验证码。令牌失效后，在本机更新 Egern 模块 Env 中的 Token。

`YJB_SIGNING_SECRET` 是接口签名材料，按养基宝 API 文档获取后只填入 Egern 本机模块 Env。不要将其写入模块 YAML、脚本、公开配置或聊天消息。若要让数据请求经指定策略组发出，可设置 `YJB_POLICY` 为现有策略组名称。

## 请求与认证

默认使用 `https://app-api.yangjibao.com`。每个请求都使用 Token、Unix 时间戳及本地 `YJB_SIGNING_SECRET` 计算 `Request-Sign`，并发送 `Authorization: ios:<token>`、`Request-Time`、`Request-Sign`。如你在本机部署了兼容网关，可用 `YJB_API_BASE` 改为该地址；网关仍需按 API 文档验证签名。脚本不会执行登录，也不会收集手机号或验证码。令牌失效时需在养基宝仓库工具支持的登录流程中重新登录，并把新 Token 更新到本地环境配置。

脚本默认使用 HTTPS 新接口。代码保留旧接口兼容分支，但旧接口基于 HTTP，不建议启用。

## 状态与限制

- 尚未配置凭据或请求报错：显示具体的配置/请求状态；网络请求超过 6 秒仍未完成时显示“加载中”；若 24 小时内有成功缓存则显示缓存，并标出“缓存”。
- 空账户或无持仓：显示“暂无基金持仓”。
- 更新时：显示“加载中”状态；成功时显示“实时”和本机更新时间。
- 养基宝接口字段可能变化。批量接口当前没有在仓库 CLI 输出中证明具体的涨跌幅字段，因此脚本尝试常见字段；若接口不返回涨跌幅，会清楚回退到持有收益或显示“涨跌暂不可用”。
- 小组件刷新由 iOS/Egern 系统调度控制，`ctx` API 不保证秒级推送更新。

## 本地配置安装

如果不使用模块管理，可将 `yjb-fund-widget.js` 放在配置文件旁边，并将 `yjb-widget-config.yaml` 中的 `scriptings` 与 `widgets` 两项合并到 Egern 配置。不要同时安装本地条目和远程模块，否则可能产生同名小组件。

## 验证与限制

基金接口字段可能变化。脚本尝试读取常见日涨跌字段；接口未返回时回退显示持有收益或“涨跌暂不可用”。组件刷新由 iOS/Egern 系统调度控制。真实账户端到端验证需要在 Egern 本机填写有效 Token 和签名密钥。
