# A4 双手机联调计划（待部署授权后执行）

前置（缺一不可）：
1. 部署授权 → 发布回滚快照 `backup-a4-predeploy-<部署日>`（固化当前线上 A3 版）→ `tcb fn deploy healthApi --force`（同时修复 A3 装配缺陷：家属视图数据路由）；
2. 体验版上传（含 A4 页面：record-bp/record-bg/med-list/home-family 家属态入口）→ 公众平台设体验版；
3. 手机 A=owner、手机 B=家属（验收期已绑定；若已撤销需重新邀请加入）；
4. 仅脱敏测试数据（血压 128/78、血糖 6.4、用药"降压药 1片"等测试值）。

## 步骤与佐证

| # | 操作 | 预期 | 佐证（与截图配对） |
|---|---|---|---|
| 1 | B 家属首页→家属代录→代录血压 128/78 | 成功 toast；A4-F01 | `tcb db nosql` 查 records：`_openid=A`、ownerOpenId=A、createdByMemberOpenId=B、createdByRole=member（掩码） |
| 2 | B 代录血糖 6.4 | 成功；A4-F02 | 同上 type=bg |
| 3 | B med-list 待确认项点"已服"（或跳过） | 成功；A4-F03 | confirmations 文档审计字段 + status |
| 4 | B med-list 长按计划/记录详情删除 | 入口不存在/守卫 toast；A4-F04 | 无对应写文档产生（db 查询计数不变） |
| 5 | A 首页/记录列表 | 可见 B 代录的血压/血糖记录（owner 归属） | records 查询响应 |
| 6 | B 尝试看无权块（如 A 关闭 bg read 后刷新） | 响应不含 bg 记录 | 同次响应导出 |
| 7 | B 撤销自己本次代确认 | 成功；再撤第二次→"该确认不可撤销" | confirmations 删除前后计数 |
| 8 | B 尝试撤销 A 创建的确认 | 拒绝（foreignRecord/notFound） | 响应 code |
| 9 | A 撤销 B 授权 → B 再代录 | 拒绝 noBinding/revoked；A4-F05 | 响应 familyWrite.reason |
| 10 | 清理 | 删除本轮 records/confirmations 测试文档（按 _id 精确）、family_members 视情况保留或撤销态保留 | 删除 n 值记录 |

截图与接口响应分开归档；截图不单独证明归属（以 db 掩码记录+响应为准）。

## 回滚

- 首选：部署前发布的快照 `backup-a4-predeploy-<部署日>`（=当前线上 A3 版，含装配缺陷，仅保底）→ `tcb fn config-route healthApi <该版本号> 100 -e kangxiaoji-d5gw2k203f0488a9e`；
- 更大回退：`tcb fn config-route healthApi 3 100 -e kangxiaoji-d5gw2k203f0488a9e`（v3=A2 代码、无 A3 家属闸口，家属视图将按 self 语义返回，慎用）；
- 页面侧回滚=不上传/回退工作区；
- 判别命令：familyView 探测——A4/A3 版对无绑定账号返回 `allowed:false, reason=noBinding`；A2 版无闸口按 self 返回本人数据。
