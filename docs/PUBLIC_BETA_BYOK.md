# Web Public Beta：TokenHub 请求级 BYOK

更新日期：2026-10-28（Asia/Shanghai）

## 阶段结论

`004-PB-02` 已完成腾讯云 TokenHub 三步连接向导和请求级 BYOK 主链路。Public Beta 用户在当前页面粘贴自己的 API Key，完成一次使用合成生活描述的结构化连接测试后，即可使用现有正式 Chat、自动保存和智能追问流程。

本阶段只完成代码和 Mock 验证，没有调用真实 TokenHub 或智谱模型，没有部署公网，也没有读取或修改真实生活记录。

## 用户流程

入口：`我的 → AI 连接 → 免费开启 AI`

1. **领取试用权益**
   - 官方地址：`https://console.cloud.tencent.com/tokenhub/`
   - 页面说明实际额度、期限和计费规则以腾讯云控制台为准，不宣传绝对免费。
2. **获取 API Key**
   - 官方地址：`https://console.cloud.tencent.com/tokenhub/apikey`
   - 用户返回 AI-LifeOS 后粘贴自己的 Key。
3. **连接并测试**
   - 用户明确点击后才发起测试。
   - 测试使用固定合成文本，不读取或上传用户的生活记录。
   - 服务端固定 TokenHub 官方 Chat Completions 地址和当前允许的模型。
   - HTTP 成功后仍须通过现有生活记录 Schema 校验，才显示“已验证连接可用”。

页面同时区分：尚未连接、验证中、Key 无效、模型未授权、额度或计费受限、网络超时、结构化输出不合格和连接可用。

## API Key 生命周期

- 默认情况下，Key 仅存在于当前 React 页面内存和当前一次 HTTPS 请求体。
- 用户可主动勾选“在本次浏览会话中记住 API Key”；勾选后，Key 写入当前标签页、当前精确来源的 `sessionStorage`，同一标签页刷新时可以恢复。该选项默认关闭。
- 恢复只代表取回此前通过测试的会话凭据；页面明确标注“尚未重新执行连接测试”，不会伪造一次新的真实推理验证或测试 usage。
- 取消勾选、点击“清除已记住的 Key”或断开连接都会删除对应会话凭据。关闭标签页或浏览器会话后也不保证保留。
- Key 不写入 `localStorage`、IndexedDB、URL、Cookie、分析事件或公开配置。`sessionStorage` 仍可被同源页面脚本读取，因此只建议在可信设备使用。
- 服务端只在当前请求调用 TokenHub 时使用 Key，不写数据库、文件、缓存正文或响应。
- 普通遥测只记录 Provider、模型、耗时、成功状态、脱敏错误码、usage 和 correlation ID；不记录 Key 或用户原文。
- 幂等指纹使用 Key 的单向 SHA-256 指纹参与冲突判断，缓存不保存 Key。
- Public Beta 没有请求级 Key 时，Chat、分析和 Follow-up 返回 `byok_required`，不会回退使用开发者环境变量 Key。
- 不同浏览器页面和请求各自携带 Key，服务端不建立可被其他用户复用的凭据会话。

## 服务端边界

- 固定上游：`https://tokenhub.tencentmaas.com/v1/chat/completions`
- 固定模型：由服务端 `TENCENT_TOKENHUB_MODEL_ID` 决定；浏览器不能覆盖为任意模型。
- 禁止自定义 Base URL，避免 SSRF。
- `proxy.ts` 只为 `AIOS_PUBLIC_BETA_HOSTS` 中精确列出的 HTTPS 主机签发内部验证头。
- 浏览器伪造的 Public Beta、LAN 和旧 Public Test 内部头会先被删除。
- Public Beta 仅开放主页面、静态资源、TokenHub 连接测试、Chat、Parse、Follow-up 和本地迁移状态读取所需路径。
- 图片 AI、ChatGPT OAuth、Health、Telegram、`/model-test` 和未知 API 默认拒绝。
- 写请求必须满足同源 `Origin`，响应带 `no-store`、CSP、HSTS、Permissions-Policy 和基础安全头。

## 与现有 Provider 的兼容性

- 本机 loopback 个人版保持原有 ChatGPT 套餐、TokenHub 环境变量和 OpenRouter 行为。
- LAN 模式保持原有访问码与本地规则边界。
- Public Beta 主链路只启用请求级 TokenHub BYOK；其他未适配 Provider 不会静默使用开发者凭据。
- 智谱 BigModel 邀请入口保留为后续需求：
  `https://www.bigmodel.cn/invite?icode=5PuOaYn30hiiicmd1LCQhXHEaazDlIZGj9HxftzTbt4%3D`
  页面明确标注连接尚未开放且该地址为推广邀请链接。

## 自动化覆盖

- 三步向导官方链接和非敏感步骤状态。
- Key 格式、长度和换行校验。
- Key 不进入浏览器持久化存储、URL 或 Cookie。
- 401、403、429、超时、网络和 Schema 错误分类。
- Chat、分析和 Follow-up 使用当前请求 Key。
- 无 BYOK 时不读取或调用开发者私人 Key。
- 两个模拟用户的 Key 不混用。
- 连接测试使用合成文本并执行结构化校验。
- Chat 与 Follow-up 幂等重放不重复调用上游。
- Public Beta 精确 HTTPS 主机、同源写入和最小路由白名单。

## 人工验收步骤

正式 HTTPS 隔离环境准备完成后：

1. 使用 390px 左右宽度的手机浏览器打开 Beta 地址。
2. 进入“我的”，确认出现“AI 连接方式”和“免费开启 AI”。
3. 检查两条腾讯云官方链接、费用与隐私提示。
4. 粘贴测试 Key，明确点击连接测试；确认页面提示该测试可能消耗少量 Tokens。
5. 确认成功后进入记录页，以合成文字完成一次 Chat、自动保存和首轮追问。
6. 不勾选记忆选项时刷新页面，确认再次推理前要求重新连接；勾选后在同一标签页刷新，确认恢复 Key，但页面不显示新的测试 usage，也不宣称刚刚完成真实验证。
7. 点击“清除已记住的 Key”和“断开连接”后分别刷新，确认都要求重新连接；新标签页或不同来源不得复用该会话凭据。
8. 在 Android Chrome 和 iPhone Safari 分别检查无横向溢出、系统键盘、错误提示、断开连接和重新连接。

不得使用真实生活记录执行首次部署验收。

## 剩余发布门禁

1. **部署方式**：限流和 Chat/Follow-up 幂等仍是单进程内存实现。首发必须强制单长期运行实例；多实例或 Serverless 发布前必须换成共享原子存储。
2. **HTTPS 与生产构建**：尚未完成真实 HTTPS 部署、独立生产构建和手机真机验收。
3. **隐私与条款**：需要发布正式隐私说明、第三方 AI 数据处理告知、用户条款和删除/备份说明。
4. **开源合规**：AGPL 修改版的 Corresponding Source 真实地址和显著入口仍是发布阻断项。
5. **运营配置**：用户需在腾讯云控制台确认 TokenHub 模型、试用/计费、消费限制和生产环境变量；本阶段没有代替用户确认控制台状态。
6. **Provider 范围**：智谱 Provider 尚未实现，不阻塞 TokenHub 首期，但不得显示为已可连接。
