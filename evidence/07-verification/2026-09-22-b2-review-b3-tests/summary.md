# 实施批次 4 · B2 等价性复核 + B3 最小云端逻辑测试 · 摘要

- 日期：2026-09-22（10:52–11:35，UTC+8）
- 仓库：`D:\data\我的资源\AI航线\约稿\豆包模型约稿\xiaochengxu`
- 分支/HEAD：`feat/family-permission` @ `a751776be194bb0a9d11cf42c27f093ab5109aca`
- 环境：Node v22.23.2 / npm 10.9.8（豆包会话运行时，路径已核实）；未切分支、未提交、未部署、未升级 Node；B1/B4/B2 改动全部保留。
- 本轮生产代码改动：**零**；仅新增 1 个测试文件。

## 1. 复核结论：B2 提取未改变原业务行为

方法：提取 HEAD 源码中的函数声明（参数括号与函数体分别配平），与共享模块导出函数做空白归一化的**逐字比对**：

- **22 个纯函数全部 IDENTICAL**（日期、格式化、入参断言、默认值/关系/规则、权限判断、归一化、用药校验等）；
- **3 个 db 依赖函数等价**：`assertOwnedDocument` 逐字一致；`getProfileDisplayName`、`getFamilyAccessContext` 唯一文本差异是 `COLLECTIONS`→形参 `collections`（注入同一对象），含 ownerPreview 回退分支与 mode/revoked 判定全部保留；
- index.js 无对已删除符号的悬空引用；注入键名与 HEAD 一致；
- 第一方模块**无循环依赖**（检测到的 9 处循环均在第三方 node_modules 内），引用为干净 DAG；
- 独立进程只加载三个共享模块时 wx-server-sdk 不在缓存、只加载 3 个文件——无 init/网络副作用；
- 回归脚本确实注入共享实现（16 项依赖全部 require 自共享模块，唯一保留的 getProfileDisplayName 是委托真实工厂的计数包装）。

复核期间一度出现两个 normalize 函数"DIFFERENT"，查明是**复核提取器自身缺陷**（默认参数花括号被提前计数），非代码差异，修正后一致。完整逐项核对见 `equivalence-review.md`。

证据强度说明：逐字文本比对 + 加载追踪能证明"提取未改变这些函数、无加载副作用"，但不替代真实云环境运行，也不覆盖未执行路径（见第 3 节）。

## 2. 新增覆盖：41 个直接测试

文件：`tests/unit/shared-policy.test.js`（Jest 29.7，沿用现有测试工程，无新依赖、无第二套工程）。直接 require 真实模块，预期值按 HEAD 契约字面填写：

| 组 | 覆盖 |
|---|---|
| 北京日期（固定系统时间，结束恢复） | UTC 16:30 跨日、15:59:59、16:00 整点、年初边界、月份补零 |
| 纯断言/格式化 | buildLogId、getRecordStatus、对象断言、trim/超长/必填、数字范围边界、可选数字、时间格式、枚举 |
| 默认结构 | scopes 四项全开（含 meta 全文）、noticeRules 三档开关、旧关系四项、关系回退、默认成员 |
| enabled 权限 | 长/短键别名允许、关闭/缺失拒绝、关系形态、展示文案连接与"暂未授权" |
| 归一化 | 空入参回落、member 合并、数组校验、关系切换、scope 过滤、全关抛错、邀请码别名与必填 |
| 用药校验 | times 去重/数量/格式、endDate、名称必填；确认状态三枚举及默认文案、自定义文案、必填 |
| db 工厂（最小替身） | 归属：本人/他人/不存在/空 ID；名称命中与"家人"兜底；访问：member、ownerPreview、无关系、已撤销 |

数据库替身只实现实际使用的 where/orderBy/limit/get 与必要过滤，未编造云端保障；时间类测试均 `useFakeTimers` + `setSystemTime`，不依赖墙上时钟。测试只断言**现有** enabled 行为与旧关系白名单，未把 read/write/remind 新契约写成已实现。

## 3. 剩余缺口（HEAD 既有，本轮未改）

- family-service.js、settings-data-service.js 仍各自内置 `getTodayDateValue`；daily-stats/report/family/settings-service 仍各自内置 `CHINA_TIME_OFFSET_MS`——B2 未消除的其他副本，已登记，建议后续统一收敛（本轮不改业务规则）。
- 回归脚本未注入 medication-service 的 `_`：getMedHistory 命令查询路径（L444-L445）无本地回归覆盖，不宣称该路径已覆盖。
- settings.test.js 的 UTC/北京时区敏感性仍在：本轮执行时段（北京上午）其 22 个用例通过；北京 00:00–08:00 仍会出现 2 个失败，未修、未等时段、未掩盖。
- 默认 scopes 全开、旧关系名单等按现行为保留；"保留原行为"不等于"新模型下安全"，相关风险随 A0/A1 改造处理。

## 4. 实际测试结果（真实退出码）

| # | 命令 | 退出码 | 结果 | 输出 |
|---|---|---|---|---|
| 1 | `npm test -- --runInBand tests/unit/shared-policy.test.js` | **0** | **41/41**，1 套件通过 | `b3-tests.txt` |
| 2 | `npm run regression` | **0** | `health-api-regression: ok`（B1 四组仍实际执行） | `regression.txt` |
| 3 | `npm test -- --runInBand` | **0** | **398/398，17 套件全部通过**（357 存量 + 41 新增） | `full-test.txt` |

本轮未引入任何新失败。

## 5. 补丁与历史批次区分

`fix.patch` 仅含本轮新增的 `tests/unit/shared-policy.test.js`（new file，473 行），不含 B1/B4/B2 任何改动；已验证可在干净 HEAD 上 `patch -p1` 干净应用，应用后内容与工作区逐字一致。

## 6. 本地 Mock 与真实云端验证的边界

- 全部为本地 Jest、最小 db 替身与本地 Mock 回归：不连真实云数据库，未验证云函数 _openid 归属、安全规则、inviteCode/attempts 索引、频控、真实邀请/加入链路、云函数部署行为；
- 等价性复核是静态文本 + 模块加载证据，不是云端运行证据；本地 398 全绿不等于云端验证通过；
- 未做微信开发者工具编译、预览、真机或双账号验证。

## 7. 累计未提交改动（截至本轮结束）

已跟踪修改 5 个（与 B2 结束时相同，本轮无新增生产改动）：index.js、medication-service.js、record-service.js、health-api-regression.js、page-data-consistency.test.js。

新增未跟踪代码 4 个：payload-helpers.js、payload-validation.js、family-policy.js（以上 B2），**tests/unit/shared-policy.test.js（本轮 B3）**。另有既有的 docs 分析文档与 evidence/。

## 8. 未执行项

A0/A1 三级权限、全仓 Lint 清理（台账 12 error/34 warning）、Node18 升级、云端配置/索引、真实数据库操作、部署、电话提醒/代录/绑定范围改动——均未进行。本轮到此结束，不进入下一阶段。
