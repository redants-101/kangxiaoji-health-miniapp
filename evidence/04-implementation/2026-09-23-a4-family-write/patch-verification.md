# A4 fix.patch 生成与校验记录（重生成版，16 文件）

## 背景

批次收尾发现 record-bg 页面遗漏家属态分支（见 summary §1.9），补测试（先行失败留证 before-record-bg-fix.txt）与实现后，fix.patch 由 15 文件重生成为 16 文件。

## 基线树构建（不依赖历史补丁链重放）

1. `pre/` = 当前工作区中旧 A4 补丁覆盖的 15 个文件副本，用旧 fix.patch（剔除 a4-family-write.test.js 段）`patch -R -p1` 反转 → 得到精确的 A4 前状态（14 文件；测试文件为 A4 新增，pre 中不存在）；反转输出 REVERSE-OK，无 .rej；
2. `pre/pages/record/record-bg/index.js` = `git show HEAD:...`（已核实：全部历史批次补丁 grep record-bg 零命中，即无任何前序批次触碰该文件，HEAD 版即 A4 前状态）；
3. `post/` = `pre/` 副本 + 16 个工作区文件覆盖。

## 补丁生成

`git diff --no-index .a4tmp5/pre .a4tmp5/post`（16 个 diff 段）→ sed 归一化标签（`a/.a4tmp5/pre/`→`a/`、`b/.a4tmp5/post/`→`b/`）→ 本目录 fix.patch。

## 校验（独立副本）

```
cp -r pre verify && cd verify && patch -p1 --batch --forward < fix.patch
→ APPLIED-CLEAN（exit 0，无 .rej）
16 文件 cmp 逐字节 vs 工作区 → MATCH 16/16
```

文件清单：cloudfunctions/healthApi/{family-service,index,medication-service}.js、pages/family-sub/home-family/index.{js,wxml}、pages/medication/med-list/index.{js,wxml}、pages/record/record-bp/index.js、pages/record/record-bg/index.js、scripts/health-api-regression.js、services/family.js、tests/unit/{a0-contract-integration,a1-member-isolation,a3-family-readonly,a4-family-write}.test.js、utils/api.js。

## 备注：历史补丁链重放的观察（不阻塞本批）

尝试以 `HEAD + 历次 fix.patch 顺序应用` 重建基线时，a3-family-readonly 补丁在部分链序下对 family-service.js/index.js 出现上下文不匹配（疑为该补丁按不同基线生成）。本批校验因此改用"工作区反转推导"路线：工作区为唯一事实源，pre 树由已按字节校验过的旧 A4 补丁精确反转而来，结论不依赖历史链重放。历史链完整性核查留待后续批次单独处理，不在 A4 范围。
