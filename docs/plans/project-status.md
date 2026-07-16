# 项目当前状态与下一步规划（整合索引）

> Track: both（本文档汇总四条线的状态，具体归属见第2节表格）
> 日期：2026-07-13
> 定位：本文档不是新的规划源，而是把散落在 `docs/roadmap.md`、
> `docs/plans/ui-preferences-knowledge-status.md`、`docs/plans/ui-review-backlog.md`、
> `docs/adr/0015-chat-first-agent-actions.md` 四条线的当前状态汇总到一处，
> 方便一次性看清"现在在哪、下一步做什么"。四份原始文档仍是各自话题的权威来源，
> 本文档过时后应重新核对并更新，而不是长期独立维护一套平行的真相。

## 1. 一句话总结

单篇论文阅读闭环（M1）与 Memory 结构对齐（M1.5）已经完工并等待一次真实
Zotero 运行时确认；UI 交付的前三个阶段已确认，第四阶段（主列表知识状态列）
未开始；ADR 0015 的 Chat-first 改造已经把 Note / Rate / Depth / Undo 四个动作
迁入 Chat，Code / Topic / Build / Repair 等仍是后续阶段。**当前没有相互矛盾的
路线，只有文档更新滞后于代码的地方**（见第 4 节）。

## 2. 四条文档线各自管什么

| 文档                                            | 性质                                 | 管辖范围                                                      | Track                                    |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------- | ---------------------------------------- |
| `docs/roadmap.md`                               | 产品路线图，长期存活                 | 产品定位、M1/M1.5/M2/M3 里程碑、Codex 能力接入策略            | both                                     |
| `docs/plans/ui-preferences-knowledge-status.md` | 一次性交付计划，四阶段确认后即可归档 | 侧栏/设置页视觉与交互、主列表知识状态列                       | both（Phase 1-3 frontend，Phase 4 both） |
| `docs/plans/ui-review-backlog.md`               | 交付计划执行期间的评审待办清单       | 具体 bug/打磨任务的领取-实现-复核流程                         | frontend                                 |
| `docs/adr/0015-chat-first-agent-actions.md`     | 架构决策记录，长期存活               | Chat 作为唯一授权入口、Action Card 生命周期、各动作分阶段落地 | both                                     |

**Track 约定（2026-07-13 起）**：每份 ADR 的 frontmatter 和每份 plan 文档顶部
的引用块都带一行 `track: frontend | backend | both`，标注这份文档主要落在
前端、后端，还是两者耦合。这不是重新拆目录（讨论过，放弃了——大部分决策本
就是全栈的，拆目录会强迫互相耦合的决策分挂两处），只是给检索加一个可过滤
的标签，例如 `grep -rl "track: frontend" docs/adr` 就能列出所有纯前端决策。
15 份 ADR、`roadmap.md`、`memory-philosophy.md`、`docs/plans/` 下三份计划均已
标注；新增文档时随手加一行即可，不需要额外流程。

关系：UI 交付计划的 Phase 4 是 roadmap 里 M1.5 之后的一项独立工程；
ADR 0015 的分阶段落地本身不在 roadmap 的里程碑表里显式出现，但其里程碑
（Note/Rate/Depth 已完成，Code/Topic 是 M2 的一部分）与 roadmap M2 的
"source-code retrieval/analysis" 和 M1.5 的 tiered engagement 是同一件事在
不同文档里的两种切面。

## 3. 逐项现状

### 3.1 产品路线图（`docs/roadmap.md` 第6节）

| 里程碑                             | 状态                           | 备注                                                                                                                                                |
| ---------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 深度单篇理解                    | ✅ 代码完成                    | 冷启动、质量闸门、扫描件解析、截图理解、选区提问、耐久性、Paper Signal 全部完成；仅 M1-7（标注导入等）留在 backlog，按需启动                        |
| M1.5 Memory 系统对齐（当前里程碑） | ✅ 代码完成，⚠️ 等待运行时确认 | 写作纪律拆分、engagement tier、质量闸门 tier 化、冷启动关联建议、语言策略、认知标签六项均已完成，但均标注"Awaiting runtime confirmation/validation" |
| M2 知识网络开始生效                | 部分完成                       | GitHub 代码分析、`code-notes.md`、backlinks、显式 Topic Notes 已完成（ADR 0014）；自动仓库发现、图可视化、库级别提问、Living Survey 仍未开始        |
| M3 领域级知识框架                  | 未开始                         | 依赖 M1/M2 的知识存量                                                                                                                               |

**关键判断**：roadmap 自己写的策略是"进入 use more, build less 阶段"——
不是功能不够，而是 Vault 里论文样本不够（北极星是30篇合格记录）。这意味着
下一步的重心应该是**用它、攒够样本**，而不是继续新增里程碑功能。

### 3.2 UI 交付计划（四阶段）

| Phase                                                   | 状态           |
| ------------------------------------------------------- | -------------- |
| 1. Theme and Layout Foundation                          | ✅ Confirmed   |
| 2. Sidebar Reading Flow and Safe Session Actions        | ✅ Confirmed   |
| 3. Preferences Information Architecture and Reliability | ✅ Confirmed   |
| 4. Main Item-Tree Knowledge Status and Batch Loop       | ❌ Not started |

Phase 4 尚未开工前的规划建议（`ui-review-backlog.md` D2 已经写明）：范围明显
大于前三个阶段（新模块 `KnowledgeStatusIndex`、ItemTreeManager 列、批量菜单
联动），且有"渲染路径零 Vault I/O"这条硬性架构约束，**建议开工前单独走一轮
Plan**，不要直接进代码。

### 3.3 UI 评审待办清单

A（bug 修复）、B（设置页快速修复）、C（侧栏打磨 C1–C5）、D1（Phase 3）均已
完成并通过复核。剩余：

- **D2（Phase 4）** — 未开始，同上，等一轮独立 Plan。
- **G1（cold-start 编排缺口）** — ✅ 代码完成（commit `ef87c79`）。roadmap
  §2.3 承诺"用户在空记录上提问时先自动初始化"，但从未实现；实测复现为：
  在未建档的 L1 论文上直接提问，Codex 会把内部草稿 JSON 混进可见回答。
  现在 `research-turn/orchestrator.ts` 检测到空骨架会先静默跑一次 Build，
  再回答问题。待真机复核。
- **A1（幽灵引用按钮，最终移除）** — ✅ 已解决（commit `86dded6`）。四轮
  修复（`cfe3389`/`e579deb`/`196b9f3`/`e08d627`，分别处理调用点缺失、
  真实选区未清除、`mouseup`/`keyup` 监听范围过宽）都未能在用户复核前
  彻底根治；2026-07-14 用户主动提出兜底方案（自动检测选区弹窗如果修不好
  就直接砍掉，改成手动复制粘贴引用），并选择不再等第四轮复核结果、直接
  执行移除。已删除悬浮引用按钮、选区检测机制、专用图标、composer 里的
  "response" chip 分支；保留了历史消息渲染里对旧数据格式的解析（不影响
  已保存的旧对话显示），以及 `chat-actions`/`research-turn/prompt.ts` 里
  `responseQuote` 作为 ADR 0015"`/note` 可 fallback 到一段引用回复"这个
  更通用设计的管线（现在永远收到空字符串，无害，不是这次移除的对象）。
- **F1/F2（Memory 视图信息架构）** — F1 ✅ 代码完成（commit `f44c56e`）：
  value-type 标签换成人话 tooltip，只读 chip 改用圆角形状与可点击按钮
  区分；`valueTypeLabel`/`valueTypeDescription` 移到 `knowledge-surface.ts`
  并补了单测。F2（Topic 选择列表过滤）仍未开始，紧迫性低于 D2，应在 30
  篇回填变密集前落地。
- **E1（拆分 `sidebar.ts`，约3600行）** — 进行中/机会性重构，不单独排期，
  只在其他改动恰好触及相关内聚区域时顺手拆分。

> 备注（来自记忆）：`origin/docs/ui-review-backlog` 及关联的
> `codex/ui-review-backlog-review-fixes`、本地 `worktree-ui-review-backlog`
> 分支落后 master 20+ 提交，是旧稿，可以忽略/清理，不必合并。

### 3.4 ADR 0015 Chat-first Agent Actions

已完成并落地到 master 的部分：

- `/note`（133ab6a）：Codex 通过 `zotero-reader-note` Skill 整理内容，写入
  `notes.md` 的 `[agent, user-confirmed]` 条目，原始提交保留在 Conversation Log。
- `/rate 1..5`、`/depth L0|L1|L2`（c091d88）：确定性评分与结构化只读深度切换，
  插件负责恢复 ownership block、tier-aware 质量闸门、投影写入、仅提交
  action-owned 路径。
- Undo：Rating/Depth 用 `git revert --no-edit`；Note 用追加撤回而非删除；
  仅当 Vault `HEAD` 仍是该 action 的提交时允许撤销。
- Memory 的 Add Thought 控件已移除；Rating/Depth 在 Memory 里改为只读展示。

仍属于后续阶段（ADR 原文 Consequences 列表）：Code、Topic、Build、Repair、
PDF enrichment、relationship proposals、action suggestions。

### 3.5 ADR 0016 统一 Agent 状态条（2026-07-13 新增，✅ 代码完成）

用户实测发现 Codex 忙碌状态展示分裂在 Chat/Memory 两个 tab 各自的 DOM 里，
切 tab 会导致状态"失联"，且 Memory 面板重渲染会让正在跑的动作状态卡死。
按 Plan 走完三阶段并已提交：

- Phase 1（`36fa2fd`）：新增 `src/modules/sidebar/agent-status-bar.ts`，
  在 `.zoteroagent-header-wrap` 挂一个两个 tab 都可见的常驻状态条，
  `showAgentStatus`/`hideAgentStatus` 改为委托给它，原 6 处 Chat 调用点零改动。
- Phase 2（`556731f`）：Build/Repair/PDF解析/Analyze code 四个 Memory 动作
  改用状态条 + token 机制，从根源解决"卡在旧节点上看不见进度"的问题；
  按钮不再兼职 Cancel，统一走 `setGenerating` 的禁用逻辑。
- Phase 3（`84c2e5e`）：Topic Note 创建、Tier Upgrade 顺带拿到了此前完全
  没有的 Cancel 能力。

`npm test`（264 用例）+ `npm run build` 全程通过。**尚待人工在真实 Zotero
里验证**：切 tab 时状态条可见性、Memory 动作中途触发重渲染不再卡死、
点 Stop 后"Cancelled."不会被迟到的失败消息覆盖。

## 4. 已修正的不一致

**ADR 0015 的 Consequences 段落曾经过时，已于 2026-07-13 修正。** 原文曾写：

> Code, Topic, depth, rating, build, repair, PDF enrichment, relationship
> proposals, action suggestions, and conservative Undo remain later phases of
> this decision.

`depth`、`rating`、`conservative Undo` 三项其实已经在 c091d88 中实现，且同一
次提交补写了 ADR 正文（新增 "The local-knowledge slice adds..." 和 "Undo is
conservative..." 两段），但没有同步更新 Consequences 里的总结句，导致同一份
ADR 内部前后矛盾。现已改为：

```markdown
- Depth, rating, and conservative Undo shipped in this decision's
  local-knowledge slice. Code, Topic, build, repair, PDF enrichment,
  relationship proposals, and action suggestions remain later phases.
```

## 5. 建议的下一步执行顺序

0. **G1/F1 真机复核**（A1 已从"待复核"变成"直接移除"，不再需要复核）——
   两个代码修复（commit `ef87c79`/`f44c56e`）都已落地并通过 `npm test`
   （264 用例）+ `npm run build`，只差在真实 Zotero 里跑一遍确认：G1 用
   一篇全新论文直接提问不再看到原始 JSON；F1 亮/暗主题下核对 tooltip 与
   形状区分效果。
1. **运行时确认 M1.5 六项"Awaiting runtime confirmation"** —— 这是最便宜、
   阻塞最多后续工作的一步：30篇回填、Phase 4 的 `record.json.quality` 读取、
   M2 的关联建议都间接依赖 M1.5 结构已经在真实 Vault 里验证过。
2. **积累知识存量（30篇北极星）** —— roadmap 自己定的下一步，先用后建。
3. **ADR 0015 剩余阶段（Code/Topic/Build/Repair 等）** —— 与 M2 的
   source-code retrieval/analysis 是同一件事，建议合并规划，不要在
   roadmap 和 ADR 0015 里各开一套时间表。
4. **UI Phase 4（主列表知识状态列）** —— 单独开一轮 Plan 后再动手，
   不阻塞前三项，可并行但不抢优先级。F2（Topic 选择列表过滤）应在 30
   篇回填变密集前落地。
5. **E1 sidebar.ts 拆分** —— 机会性进行，不单独排期。

## 6. 维护规则

- 里程碑状态变化时，先改权威文档（`roadmap.md` / ADR / 对应 plan），
  再回来更新本文件第3节的状态表，避免本文件变成第二个信源。
- 本文件如果连续两次被发现与权威文档不一致，应考虑直接废弃，
  转而让读者直接读四份原始文档。
