# KangXiaoJi Health MiniApp

康小记 - 家庭健康记录与提醒微信小程序

基于微信小程序 + 腾讯云开发（CloudBase）构建的健康记录管理应用。

[![Powered by CloudBase](https://7463-tcb-advanced-a656fc-1257967285.tcb.qcloud.la/mcp/powered-by-cloudbase-badge.svg)](https://github.com/TencentCloudBase/CloudBase-AI-ToolKit)

> 本项目基于 [**CloudBase AI ToolKit**](https://github.com/TencentCloudBase/CloudBase-AI-ToolKit) 开发，通过AI提示词和 MCP 协议+云开发，让开发更智能、更高效，支持AI生成全栈代码、一键部署至腾讯云开发（免服务器）、智能日志修复。

## 项目架构

- **前端**: 微信小程序（29 个页面，4 个 Tab 页）
- **后端**: 云函数 `healthApi`、`sendDueReminders`（Node.js 16.13，Event 类型）
- **数据库**: CloudBase NoSQL（12 个集合，含健康记录预聚合统计和提醒推送日志）

## CloudBase 资源

- **环境 ID**: `kangxiaoji-d5gw2k203f0488a9e`
- **AppID**: `wxcb641f745311f6fb`
- **云函数**: `healthApi` — 健康记录 CRUD、用药管理、家庭授权、提醒设置、报告生成；内部已拆分静态页、记录、用药、家庭、设置/数据、统计、报告和统一 timing log 服务
- **定时云函数**: `sendDueReminders` — 按分钟扫描到期用药、测量和周报提醒，发送微信订阅消息，并写入推送日志防重复

## 数据库集合

| 集合名 | 说明 |
|--------|------|
| `health_records` | 血压/血糖健康记录 |
| `health_daily_stats` | 健康记录按天预聚合统计 |
| `health_record_stats` | 健康记录用户总量预聚合统计 |
| `medication_plans` | 用药计划 |
| `medication_confirmations` | 用药确认记录 |
| `family_auth` | 家庭成员授权 |
| `family_members` | 家庭成员关系 |
| `reminder_settings` | 提醒设置 |
| `reminder_push_logs` | 提醒订阅消息推送日志 |
| `privacy_settings` | 隐私设置 |
| `feedbacks` | 用户反馈 |
| `profiles` | 用户档案 |

## 本地开发

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

## 云函数部署

本项目包含两个 CloudBase Event 云函数：

| 云函数 | 类型 | 运行时 | 说明 |
|--------|------|--------|------|
| `healthApi` | Event | Nodejs16.13 | 小程序主数据接口，负责健康记录、用药、家庭、提醒设置和报告 |
| `sendDueReminders` | Event + timer | Nodejs16.13 | 每分钟扫描到期用药、测量和周报提醒并发送订阅消息 |

部署前请先在云开发控制台确认数据库集合和索引，参考 `docs/云开发控制台初始化清单.md`。

使用微信开发者工具部署：

1. 打开“云开发”面板，确认环境为 `kangxiaoji-d5gw2k203f0488a9e`。
2. 分别右键 `cloudfunctions/healthApi` 和 `cloudfunctions/sendDueReminders`，选择“上传并部署：云端安装依赖”。
3. 确认 `sendDueReminders` 的定时触发器已生效，触发配置见 `cloudfunctions/sendDueReminders/config.json`。

使用 CloudBase CLI 时，函数根目录为 `./cloudfunctions`，部署配置见 `cloudbaserc.json`。

## 部署信息

- **最近部署时间**: 2026-04-26
- **云函数**: `healthApi` — 已部署至 CloudBase 环境
- **定时云函数**: `sendDueReminders` — 代码与触发器配置已纳入仓库，线上状态以 CloudBase 控制台为准
