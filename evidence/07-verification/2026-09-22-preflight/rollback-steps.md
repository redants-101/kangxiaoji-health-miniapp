# 回滚步骤（已核验可用部分与待执行部分分开标注）

## 已核验（本轮只读确认）

- 版本 1 `backup-before-a0a1a2-deploy`（2026-09-22 15:27:16，Deployment completed）**存在且状态正常**——内容是最初线上版（A0/A1/A2 全部功能之前）。
- 当前流量路由为空表 → 100% $LATEST；`tcb fn config-route` / `list-function-versions` 命令在本机 CLI 3.8.4 可用（语法经 --help 与 list 实测；config-route 属写操作，本轮未执行）。

## 回滚方案 A：切流量到版本 1（最快，不动 $LATEST）

```bash
tcb fn config-route healthApi 1 100 -e kangxiaoji-d5gw2k203f0488a9e
```

- 效果：全部流量走 A0 之前的旧代码；**A0/A1/A2 功能整体下线**（三级权限、错误码、频控全部消失，回到 enabled 旧模型行为）。
- 适用：新函数出现崩溃级故障时的止血。
- 恢复：`tcb fn config-route healthApi $LATEST 100`（或删除路由配置）。
- 注意：版本 1 对应的**数据库形态兼容**——旧代码不写 family_invite_attempts、不认识三级 scopes；family_auth 中被 A2 收尾前流程写入的三级结构文档对旧代码是"未知字段"，旧 getFamilyJoinData 会按旧逻辑渲染（enabled 缺失 → 范围为空），不崩溃。family_members 当前 0 条，无脏数据风险。

## 回滚方案 B：回滚到"A2 已部署版"（推荐的新回滚点，部署前需先建立）

当前**不存在**收尾批次的中间回滚点。部署前执行：

```bash
tcb fn publish-version healthApi "backup-a2-deployed-20260922" -e kangxiaoji-d5gw2k203f0488a9e
```

之后如收尾版本（noInvite/原子频控/事务重验）出问题：

```bash
tcb fn config-route healthApi 2 100 -e kangxiaoji-d5gw2k203f0488a9e   # 版本号以 list-function-versions 实际输出为准
```

- 效果：保留 A0/A1/A2 主体功能，仅回退收尾批次改动。
- 数据兼容：A2 版频控读旧形态（每失败一条记录），收尾版写计数文档——**混用期间频控计数不互通**（A2 版 count 查询按 openId+day 数文档条数，会把计数文档也算作 1 条失败记录，方向偏严不放宽）；回滚窗口内可接受，恢复后自动一致。

## 验证回滚生效

```bash
tcb fn invoke healthApi -e <envId> --params '{"key":"familyJoin","payload":{},"userInfo":{"openId":"smoke-rollback"}}'
```

- 版本 1（旧代码）：返回旧默认页（remainHours=24、含 4 个默认可查看范围、**无 noInvite 字段**）；
- A2 版：返回 remainHours=24 默认页（无 noInvite）；
- 收尾版：返回 `noInvite:true`。三者可判别。
- 冒烟产生的数据：旧代码/A2 版无写入；收尾版无写入（缺码不计数）。无需清理。
