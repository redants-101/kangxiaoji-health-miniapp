# 康小记 - 健康管理微信小程序

基于微信小程序 + 腾讯云开发（CloudBase）构建的健康记录管理应用。

[![Powered by CloudBase](https://7463-tcb-advanced-a656fc-1257967285.tcb.qcloud.la/mcp/powered-by-cloudbase-badge.svg)](https://github.com/TencentCloudBase/CloudBase-AI-ToolKit)

> 本项目基于 [**CloudBase AI ToolKit**](https://github.com/TencentCloudBase/CloudBase-AI-ToolKit) 开发，通过AI提示词和 MCP 协议+云开发，让开发更智能、更高效，支持AI生成全栈代码、一键部署至腾讯云开发（免服务器）、智能日志修复。

## 项目架构

- **前端**: 微信小程序（29 个页面，4 个 Tab 页）
- **后端**: 云函数 `healthApi`（Node.js 16.13，Event 类型）
- **数据库**: CloudBase NoSQL（11 个集合，含健康记录预聚合统计）

## CloudBase 资源

- **环境 ID**: `kangxiaoji-d5gw2k203f0488a9e`
- **AppID**: `wxcb641f745311f6fb`
- **云函数**: `healthApi` — 健康记录 CRUD、用药管理、家庭授权、提醒设置、报告生成；内部已拆分静态页、记录、用药、家庭、设置/数据、统计、报告和统一 timing log 服务

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
| `privacy_settings` | 隐私设置 |
| `feedbacks` | 用户反馈 |
| `profiles` | 用户档案 |

## 部署信息

- **最近部署时间**: 2026-04-26
- **云函数**: `healthApi` — 已部署至 CloudBase 环境
