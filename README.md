# KangXiaoJi Health MiniApp

康小记 - 家庭健康记录与提醒微信小程序

基于微信小程序 + 腾讯云开发（CloudBase）构建的健康记录管理应用。

[![Powered by CloudBase](https://7463-tcb-advanced-a656fc-1257967285.tcb.qcloud.la/mcp/powered-by-cloudbase-badge.svg)](https://github.com/TencentCloudBase/CloudBase-AI-ToolKit)

> 本项目基于 [**CloudBase AI ToolKit**](https://github.com/TencentCloudBase/CloudBase-AI-ToolKit) 开发，通过AI提示词和 MCP 协议+云开发，让开发更智能、更高效，支持AI生成全栈代码、一键部署至腾讯云开发（免服务器）、智能日志修复。

> **2026-09 家庭权限二开（B1–A7）已落版**：tag `v1.0-family-permission`。范围、验证状态与边界见下文"本次二开"与"状态与边界"；过程证据见 `evidence/`。

## 项目架构

- **前端**: 微信小程序（含家庭 Tab 与家属视角子包 `pages/family-sub`）
- **后端**: 云函数 `healthApi`、`sendDueReminders`（Node.js 16.13，Event 类型）
- **数据库**: CloudBase NoSQL（含健康记录预聚合统计、提醒推送日志与家庭邀请频控计数）

## CloudBase 资源

- **环境 ID**: `kangxiaoji-d5gw2k203f0488a9e`（测试环境，无正式用户与正式流量）
- **AppID**: `wxcb641f745311f6fb`
- **云函数**: `healthApi` — 健康记录 CRUD、用药管理、家庭授权与家属代录、提醒设置、报告生成；内部已拆分静态页、记录、用药、家庭（family-service/family-policy）、设置/数据、统计、报告和统一 timing log 服务
- **定时云函数**: `sendDueReminders` — 按分钟扫描到期用药、测量和周报提醒，发送微信订阅消息（仅推送 owner 本人；家属侧不做订阅推送，见"电话提醒"）

## 数据库集合

| 集合名 | 说明 |
|--------|------|
| `health_records` | 血压/血糖健康记录（家属代录含 ownerOpenId/createdByMemberOpenId/createdByRole/source 审计字段） |
| `health_daily_stats` | 健康记录按天预聚合统计 |
| `health_record_stats` | 健康记录用户总量预聚合统计 |
| `medication_plans` | 用药计划 |
| `medication_confirmations` | 用药确认记录（代确认含审计字段） |
| `family_auth` | 家庭授权/邀请配置（inviteCode 建 sparse 唯一索引；含 owner 提醒电话 contactPhone） |
| `family_members` | 家庭成员关系（active/revoked；scopes 三级权限） |
| `family_invite_attempts` | 邀请查询失败计数（频控 20 次/自然日；createdAt TTL 24h 索引，控制台创建） |
| `reminder_settings` | 提醒设置 |
| `reminder_push_logs` | 提醒订阅消息推送日志 |
| `privacy_settings` | 隐私设置 |
| `feedbacks` | 用户反馈 |
| `profiles` | 用户档案 |

`app_configs`（A7 远程开关）**未创建**：未创建时 `appConfig` 接口回退端侧默认（正式版关、体验/开发版开），无故障面；启用远程开关需控制台创建并写入 `{_id:'app_config', familyTabEnabled:boolean}`。

## 本次二开（2026-09，B1–A7）

- **A0 三级权限契约**：scopes `{key,title,meta,read,write,remind}` 严格布尔、缺失即 false；权限判断单点实现于 `cloudfunctions/healthApi/family-policy.js`；write 动作要求同 scope read+write；用药计划增删改与记录删除永不向家属开放。
- **A1 成员隔离**：一位家属仅绑定一位老人（1:1），撤销/注销按 memberId 精准生效。
- **A2 邀请安全**：显式生成邀请码（24h 有效）、错误码四态（无效/过期/已撤销/已被使用）、失败频控。
- **A3 家属只读闭环**：家属视角数据一律经服务端闸口（active 关系 + 当前 scopes）按次判定；页面只读态。
- **A4 家属代录**：血压/血糖代录与用药代确认（已服/跳过）；记录归属 owner（`_openid=ownerOpenId`）并带代录人审计字段；撤销仅限本人本次代确认。
- **A5 撤销实时生效与缓存治理**：家族敏感读零缓存、每次回源；服务端拒绝不回填旧缓存；请求序号守卫防旧请求覆盖；撤销/改权/代录成功后精准失效相关页面缓存。
- **A6 电话提醒**（替代家属订阅推送）：owner 配置提醒电话；家属侧仅脱敏展示（如 138\*\*\*\*1234），拨号时经 action 按需取完整号；任一 scope.remind=true 才可见/可取；撤销或关闭 remind 后立即不可获取；不实现 wx.getPhoneNumber。
- **A7 家庭 Tab 开放与回滚开关**：运行时开关 `utils/feature-flags.js`（远程 `appConfig.familyTabEnabled` 布尔优先，缺省按 envVersion：release=关、trial/develop=开）；死页 `pages/family-sub/index` 已删除。

## 本地开发与测试

1. `npm install`
2. 微信开发者工具打开项目根目录（配置见 `project.config.json`；`project.private.config.json`、`.env.local`、`node_modules/` 等已被 `.gitignore` 排除）。
3. 测试：

   ```bash
   npm test                # Jest 全量（落版时 633/633 通过）
   npm run regression      # healthApi 回归脚本
   npm run lint            # ESLint（cloudfunctions/ 不在 lint 范围）
   ```

   已知限制：`tests/unit/settings.test.js` 有两个时区敏感用例，仅在北京时间 00:00–08:00 窗口内失败（台账见 `evidence/`）；lint 的 11 errors/32 warnings 为历史基线，未夹带修复。

## 云函数部署

| 云函数 | 类型 | 运行时 | 说明 |
|--------|------|--------|------|
| `healthApi` | Event | Nodejs16.13 | 小程序主数据接口（含家庭权限闸口与家属代录） |
| `sendDueReminders` | Event + timer | Nodejs16.13 | 到期提醒订阅消息（仅 owner；二开未改动、未重新部署） |

部署前请在云开发控制台确认集合与索引（`docs/云开发控制台初始化清单.md`；family_invite_attempts 集合与 TTL、family_auth.inviteCode 唯一索引为控制台操作）。使用微信开发者工具"上传并部署：云端安装依赖"，或 CloudBase CLI（函数根目录 `./cloudfunctions`，配置见 `cloudbaserc.json`）。**只部署 healthApi 时不要连带部署 sendDueReminders。**

## 部署信息

- **healthApi 最近部署**: 2026-09-23 10:52（含 A3 装配修复 + A4–A7 后端；部署前快照 `backup-a4a7-predeploy-20260923` = v4，回滚 `tcb fn config-route healthApi 4 100`）
- **sendDueReminders**: 代码与触发器配置在仓库，线上状态以控制台为准（二开未动）
- **小程序体验版**: 截至落版**未找到人工上传证据**；体验版/正式版状态以公众平台为准

## 状态与边界（落版时点）

- 本地：目标套件与全量 Jest、回归通过（退出码见 `evidence/07-verification/2026-09-23-phase11-final-review/reverify.txt`）。
- 云端：合成身份冒烟 10/10 通过（`evidence/04-implementation/2026-09-23-a4a7-deploy-smoke/smoke-record.md`）。
- **未验证**：A4–A7 真机双手机验收（手册已备：同目录 `dual-phone-manual.md`）、体验版前端行为、release 默认关真机表现、远程开关链路。
- 本仓库为测试环境项目二开记录：**不等于产品已验收或可正式上线**。

## 证据与过程材料

- `evidence/00-baseline`…`07-verification`：基线、仓库审计、决策（decisions.md）、各批实现证据、失败台账、部署/冒烟/清理记录、阶段 11 审查与勘误。
- 截图脱敏口径：含敏感值的原图（如完整手机号/有效邀请码画面）**不入库**，仅本地保存；入库为打码副本。
- 工具归属：前期（首次对话/阶段 1–3/批次 1）据用户说明为豆包工作；B4 起为 ZCode 会话（可验证）。开发批次模型归属未确认，不作单一模型叙事。

## 本地开发（原文保留）

1. 安装依赖：

   ```bash
   npm install
   ```

2. 用微信开发者工具打开项目根目录。

3. 确认 `project.config.json` 中的关键信息：

   - `projectname`: `kangxiaoji-health-miniapp`
   - `miniprogramRoot`: `./`
   - `cloudfunctionRoot`: `./cloudfunctions/`
   - `appid`: `wxcb641f745311f6fb`

4. 本地配置文件说明：

   - `project.private.config.json` 是微信开发者工具本机配置，不提交到 Git。
   - `.env.local`、`.mcp.json`、`node_modules/`、`cloudfunctions/**/node_modules/` 已被 `.gitignore` 排除。
