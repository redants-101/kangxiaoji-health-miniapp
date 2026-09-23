# A5 子批次总结（撤销实时生效与缓存治理）— 2026-09-23 夜间批次

分支 `feat/family-permission`（HEAD `a751776`）。本子批次未提交、未切分支、未部署、未操作云端。

## 变更文件（5）

| 文件 | 变更 |
|---|---|
| services/core.js | 家族敏感读判定 `isFamilySensitiveRead`；`requestCloudByKey` 家族敏感读零缓存/失败不回填；带 errCode 的显式拒绝对任何键不回填 stale |
| utils/page-factory.js | loadKey 由 `Date.now()` 改单调序号，消除同毫秒键碰撞导致的旧请求覆盖 |
| services/family.js | 新增 `FAMILY_PAGE_KEYS`/`invalidateFamilyCaches`；撤销/改权/加入/邀请/4 个 A4 代录写成功后精准失效并置脏 |
| tests/unit/a5-cache-revocation.test.js | 新增：缓存策略、精准失效、镜像精确性、注销清理、服务端 M1/M2 撤销隔离、改权即时过滤 |
| tests/unit/a5-page-staleness.test.js | 新增：撤销后重开全部家属页面渲染拒绝态、旧请求晚返回不覆盖新状态 |

服务端云函数零改动（A3/A4 已每次调用重查 active 关系与 scopes，撤销/改权天然即时生效；本批以测试固化）。

## 测试

- 测试先行：before.txt = 9 failed / 13 passed（失败全部为新增行为断言；通过者为现状正确行为的固化测试）。
- 实现后：A5 目标 22/22（after.txt）。
- A0/A1/A3/A4 联跑 76/76。
- 全量 Jest：595/597 —— 仅 2 失败为 tests/unit/settings.test.js 时区敏感对（运行处北京时间 00:00–08:00 窗口，单独记录，未改任何 A5 代码掩盖）。
- `npm run regression`：ok。
- `npm run lint`：43 problems（11 errors / 32 warnings），与历次基线一致，无新增。cloudfunctions/ 不在现有 lint 范围（本子批次也未改 cloudfunctions）。

## fix.patch

5 个 diff 段；基线 = 本夜批开始时的工作区快照（.nightly/pre-a5，即 A4 完成态）；校验：APPLIED-CLEAN + 5/5 逐字节 MATCH（快照逐文件对比确认 A5 仅触及上述 3 个源文件 + 2 个新测试）。

## 状态口径

- **本地已验证**：上述全部测试与检查。
- **已部署但未真实验证**：无（A5 未部署；云端仍为 A3 版）。
- **云端待真实验证**：A 撤销 → B 真机下一次请求即被拒（端到端）；随 A4/A5 部署后按双手机计划验证。
- **表述纪律**：清除本地缓存 ≠ 已证明云端撤销实时生效；本批只证明客户端不以缓存为授权依据 + 服务端按当前关系判定（替身级）。
