# 本次部署的精确文件范围与内容摘要

## 1. 云函数部署范围（tcb fn deploy healthApi 打包 `cloudfunctions/healthApi/` 整个目录）

部署包内文件（磁盘现状即部署内容）：

| 文件 | git 状态 | 本次相对云端 $LATEST(15:28) 的变化 |
|---|---|---|
| index.js | 已跟踪-修改 | `cloud.database({throwOnNotFound:false})`（事务不存在语义）；此前 A2 已部署部分不变 |
| family-service.js | 已跟踪-修改 | noInvite 说明态、事务内邀请码一致性重验、有效期 NaN/刚好到期边界、原子预留频控（reserve/release）、重邀必发新码、add-catch 重复键签名判别 |
| **family-policy.js** | **未跟踪（新文件）** | 必须随包：A0 规则 + A1 锚点 + A2 错误码契约（本次无改动，但**缺失即部署失败级事故**——index/family-service 均 require 它） |
| **payload-helpers.js** | **未跟踪（新文件）** | 必须随包：日期/校验/归属工厂 |
| **payload-validation.js** | **未跟踪（新文件）** | 必须随包：记录/用药校验 |
| medication-service.js、record-service.js | 已跟踪-修改 | 本次无变化（B2 时已部署） |
| settings-data-service.js、report-service.js、daily-stats-service.js、static-pages.js、perf.js、package.json、node_modules/ | 未改动 | 原样随包 |

> **关键提示**：三个共享模块在 git 中是未跟踪新文件。`tcb fn deploy` 按磁盘目录打包，本机部署没有问题；但**任何从 git 检出/克隆的部署（CI、他人机器）都会缺这三个文件导致函数启动即崩**。提交入库前不得换机器/走流水线部署。

**不在函数包内、需另行生效的前端改动**（本轮不上传）：services/family.js、services/core.js、pages/family-sub/family-join|family-auth|family-invite、pages/family——通过微信开发者工具上传小程序版本才生效。

**不部署**：sendDueReminders（零改动）。

## 2. 前后端契约兼容性（部署函数但前端未更新期间）

| 旧前端页面 | 新云函数返回 | 表现 |
|---|---|---|
| family-join（旧 wxml 恒显徽标） | noInvite 态 remainHours=0、scopes=[] | 显示"剩余 0 小时"、范围为空——降级展示，不崩溃 |
| family-join | inviteError 对象 | 旧页面忽略未知字段，按普通预览渲染（字段为空值）——降级，不崩溃 |
| family-auth（旧 noticeRules.map） | noticeRules 为**对象** | 旧页面 `noticeRules.map` 会 JS 报错——**但该页入口在家庭页（coming-soon 占位）之后，线上不可达**；风险仅在开发者手工直跳时出现 |
| 其余页面 | 不涉及 | 无影响 |

家庭 Tab 未开放（coming-soon），上述降级面实际不可达；仍建议函数与前端体验版**同批推进**，间隔期内不做真机验收。

## 3. 部署命令（供确认后执行，本轮未执行）

```bash
# 0) 对当前 $LATEST 再发一个回滚快照（A2 已部署版）
tcb fn publish-version healthApi "backup-a2-deployed-20260922" -e kangxiaoji-d5gw2k203f0488a9e
# 1) 部署（含未跟踪共享模块，按磁盘目录打包）
tcb fn deploy healthApi --force -e kangxiaoji-d5gw2k203f0488a9e
# 2) 冒烟（见 verification-plan §1）
tcb fn invoke healthApi -e kangxiaoji-d5gw2k203f0488a9e --params '{"key":"familyJoin","payload":{},"userInfo":{"openId":"smoke-preflight"}}'
```

（npm 代理注意：需 `NPM_CONFIG_USERCONFIG=<干净npmrc>` 前缀，或先恢复本机代理软件。）
