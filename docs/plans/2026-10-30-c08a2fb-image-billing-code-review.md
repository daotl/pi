## Code Review Results

**结论：Not ready。** 本轮保留并独立验证了 **16 项问题：2 P1、14 P2**。全部需要由调用方修复；当前报告不代表修复、测试或提交已经完成。

**Scope:** `98dfe28cbeec4e1f2f61516e227420b2407dcdf9` -> `7ad22e109061a2826362b09dc548fcc8cd64c6ae` 及审查时的 tracked 工作区，覆盖 merge `8322aa1d` 和此后全部改动；1,263 个路径、195,895 行改动、72,815 行非测试可执行改动、47 个完整删除。快照没有排除的 untracked 路径。

**Intent:** 集成 upstream 1.4.0，同时保留 Crystal 历史管理、现存 Harness/experimental/client 调用方、模型及图片计费、多模态限制、摘要配置和 receipt 所有权。

**Mode:** `markdown report-only`。本叶节点未修改产品或文档、未执行测试、构建或网络请求、未提交。调用方负责将报告保存到 `docs/plans/2026-10-30-c08a2fb-image-billing-code-review.md`，然后完成全部修复和提交。

**Reviewers:** 十个 correctness 分区负责 AI、agent、Chord、Durable、env、session、integrations、interactive、tooling、docs。另选 testing（测试可信度）、maintainability（跨模块契约）、agent-native-reviewer（工具和模型可达性）、security（权限及 native/MCP 边界）、performance（流和存储开销）、api-contract（现存公开调用方）、data-migration（迁移）、reliability（进程及异步生命周期）、julik-frontend-races（真实 DOM 事件顺序）、deployment-verification-agent（SQLite v2 发布及恢复）、adversarial（外部鉴权失败后的本地替代）。原 Chord 任务取消后，另有新鲜的 bounded recovery；覆盖限制见下文。

### Triage Groups

| Group | Findings | Context | Preferred Resolution | Why |
|---|---|---|---|---|
| apply-queue：上下文与模型输入 | #1, #9, #11 | JSON 发布、嵌套调用归属、图片输入分别失守 | 先修 #1，再独立修 #9、#11；保留严格 JSON 和模型限制 | 三条不同修复路径，不能相互替代 |
| apply-queue：计费完整性 | #3, #6, #10 | 解析、聚合、迟到 receipt 都可能丢失计费信息 | 修 #3/#6，再落实 #10 的独立 receipt 生命周期及去重 | 正确聚合无法补回已失去所有者的 receipt |
| apply-queue：终端生命周期 | #4, #13, #15 | Windows kill 状态、输入容量、最终输出取消 | 保持退出及错误优先级，同时加入有界输入准入 | 平台状态、背压和取消是独立缺陷 |
| apply-queue：FIFO 调度 | #12, #14 | 路径替换会卡普通 worker；池饱和另会阻塞新 rendezvous | 先修 #12 的 open 路由，再修 #14 的饱和准入 | 路由正确不等于饱和时仍有进展 |

以下全部为 `confirmed`，严重性和置信度保持原值。确认依据是当前源码、调用方和已有 fixture；**未测量实际运行发生率，未执行这些测试**。精确的 `validation_reason` 和 `protected_subject` 已逐项原样保存在审查 artifacts。

### P1 -- High

| # | File | Issue | Reviewer | Confidence |
|---|---|---|---|---|
| 1 | `packages/coding-agent/src/experimental/services/transcript-provider.ts:327` | 普通工具事件进入严格 JSON 发布路径后丢失 | api-contract，迟到补充来源 | 100 |
| 2 | `packages/chord/src/reload.ts:805` | reload 回滚重开资源后，监听器仍绑定旧实例 | correctness-chord-recovery | 75 |

- **#1 后果与修复：** 注册的 bash 工具会产生 `details: undefined`；工具完成重建也会补出此属性。原事件直接进入 Chord draft 时，严格 `copyJson()` 抛错，snapshot 和 replay 不提交，实验客户端丢失进度及完成事件。对非 frame 事件使用 `copyJson(event, { omitUndefinedProperties: true })`，将同一规范化事件用于 reducer 和 replay；初始及重采样 snapshot 同样处理。覆盖真实 bash、无 details 的完成结果、不可用工具和 outcome-ready attachment，并通过 routed link 检查收敛。不要放宽 Chord JSON 边界。
- **#2 后果与修复：** exclusive 资源在失败回滚时可能重新创建 emitter，但现有 subscription 仍捕获已关闭的旧来源；旧代码虽然恢复，事件处理却永久停止。关闭前解绑并记录资源监听声明；依赖及资源重开后，基于新值重建订阅，再释放 gated 事件及重启任务。保留 `ResourceImpl` 身份不能被当成底层 emitter 未变。补充“每次 open 返回新 emitter、替换 open 失败、回滚后新 emitter 发事件”的回归。

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence |
|---|---|---|---|---|
| 3 | `packages/ai/src/types.ts:513` | 保留的 usage 聚合器丢失或误报 provider 计费来源 | maintainability | 100 |
| 4 | `packages/env/daemon/src/sys/windows.rs:591` | Windows cleanup 返回 1，违背约定的 137 | correctness-env | 100 |
| 5 | `packages/tui/src/tui-main-screen.ts:785` | 一行多个 Kitty 图片只绘制或清理第一个 | correctness-interactive | 100 |
| 6 | `packages/ai/src/api/openrouter-images.ts:196` | OpenRouter 图片忽略真实账单，可能记为免费 | correctness-ai | 75 |
| 7 | `packages/ai/src/telemetry.ts:67` | 同名 AI span 存在两套互不兼容的 schema | maintainability | 75 |
| 8 | `packages/coding-agent/docs/cli.md:132` | CLI 文档错误承诺未列入 allowlist 的 direct MCP 仍可脚本调用 | correctness-docs | 75 |
| 9 | `packages/coding-agent/src/core/compaction/utils.ts:68` | 旧 codemode ID 授权泄漏到后续失败 assistant | correctness-session | 75 |
| 10 | `packages/coding-agent/src/extensions/codemode/execute.ts:654` | 脚本结束后的真实模型账单无法进入持久 usage | correctness-integrations，迟到补充来源 | 75 |
| 11 | `packages/durable/src/codemode/output.ts:148` | 生成图片绕过会话模型输入限制，并永久进入历史 | agent-native-reviewer | 75 |
| 12 | `packages/env/daemon/src/main.rs:439` | FIFO 路径替换竞态使普通文件 worker 无法取消 | reliability | 75 |
| 13 | `packages/env/daemon/src/pty.rs:207` | 前台程序不读 stdin 时，PTY 输入无界占用内存 | performance | 75 |
| 14 | `packages/env/daemon/src/special.rs:548` | FIFO rendezvous 池饱和后，新 FIFO 配对仍会死锁 | reliability | 75 |
| 15 | `packages/env/src/terminal.ts:134` | 最终输出回调中的 close 被成功退出覆盖 | correctness-env | 75 |
| 16 | `scripts/local-package-install.mjs:131` | 将 npm 文件路径当 URL，误拒合法本地安装 | correctness-tooling | 75 |

| # | 后果与触发条件 | 修复及针对性回归 |
|---|---|---|
| 3 | Durable 沿用首笔 `totalFromProvider`，后续估算费用仍被标成实付；AgentHarness 则连全部实付的标志也丢失 | 迁移 `durable/src/harness/usage.ts` 和 `agent/src/harness/utils/usage.ts`，采用“所有贡献 charge 均为 provider-reported”的规则；空 accumulator 为中性。覆盖 true+true、true+false/缺省、反序及空后首笔实付 |
| 4 | 对仍运行的 Windows command cleanup 时，job 被以状态 1 终止；公开契约及跨平台测试要求 137 | 明确 kill-without-abort 使用 137；不改正常 leader 状态、timeout/abort 优先级。Windows 集成回归检查 CANCEL kill、子进程终止和 `exitCode: 137` |
| 5 | 两图片间有 CUF 时，第二张被文本层删除却未绘制；相邻图片虽可一起发出，也只登记首个清理 ID | 每个 transmission/placement 独立建 graphics record，按完整行前缀算列并保留 continuation；绘制和清理所有 ID。覆盖相邻及 CUF 分隔两种形式 |
| 6 | provider 返回非零 `usage.cost` 而目录 token rate 为零时，图片真实开销被记为零估算，并传播到 codemode receipt/session | 先 `calculateCost()` 得到分层目录 fallback，再调用现有 `applyOpenRouterReportedCost()`；保留实付总额及来源。覆盖非 BYOK、BYOK upstream cost、缺失及无效账单 |
| 7 | agent-core 导出及生成文档仍要求 `pi.ai.provider/model` 等字段，实际 Models emitter 使用 `provider/api/model`、`stop` 并新增事件及 `pi.ai.poll` | agent harness 从 pi-ai 导入唯一 `AI_TELEMETRY_SCHEMA`，据此派生类型、helper 和 combined schema；迁移测试并重新生成 telemetry reference，独立保留 Harness schema |
| 8 | `--tools read,codemode` 下，未选中的 direct MCP 虽注册但 inactive；nested filter 拒绝调用，tool_search 也不加载 direct exposure | 文档限定 codemode/deferred exposure 可间接调用；direct 工具必须在 `--tools` 中点名或匹配，如 `mcp__docs__*`，或改为间接 exposure；hidden 仍不可达 |
| 9 | 成功 assistant 的 ID 被后续 error/aborted assistant 复用时，后者本应从 provider replay 排除的嵌套文件路径仍被写进 checkpoint 标签 | 每个 assistant 开始及 user 边界清空归属 ID；仅为当前成功 assistant 归属结果，允许透明 system patch 和同一 assistant 的多结果。补 compact/branch ID 复用回归 |
| 10 | 生成图片等调用在 return、exit、race 或 timeout 后才返回 usage 时，只更新已失效的局部变量，session 永久漏账 | 为每次派发创建由 session ledger 持有的 receipt sink，跨 VM 结束保持有效，settle 时恰好写一次；独立持久化后从工具聚合扣除同一 receipt。不得恢复无限等待 host tools。用受控迟到 provider 覆盖图片/classifier |
| 11 | 输出图片符合 sandbox 总上限但超过聊天模型 resize 限制时，原图被持久化并在后续回合及 reopen 后重复发给 provider，阻断继续对话 | 原始文件保留完整字节；inline 输出经现有 `ImageProcessor` 和会话模型 resize/默认限制准备。无法处理超限图时保留路径并明确诊断，不持久化不兼容 inline。覆盖存储结果、下次请求及 reopen |
| 12 | metadata 后、open 前被替换成 FIFO 时，`fs::write` 在普通 worker 阻塞，取消标志无法解开 open；足量请求耗尽 16 个 worker | 所有 Unix write open 走注册过的可中断 opener，保留目录创建及 append/truncate 语义，按已打开 descriptor 分类后续写法。确定性替换路径后取消，不接 reader，并证明其他文件操作可完成 |
| 13 | 重复 write 到不读 stdin 的终端时，无界 channel 保留所有待写字节；单 frame/chunk 限制不限制总量 | 每终端维护 pending-byte budget，入队前 reserve，drain/drop 时释放；满时返回可重试准入错误，不阻塞共享 reader。客户端传播失败，lossless bulk 提供 awaitable write/drain；覆盖饱和时取消、resize 和其他终端 |
| 14 | 一侧 16 个 helper 被不同无配对 FIFO 占满后，新 FIFO 同侧 open 排队，另一侧 peer 虽已到达也无法配对，直到旧请求被释放 | reader/writer 池饱和时一致 fail fast，返回明确资源限制错误；若要保留排队，先实现公平 rendezvous。保留成功 descriptor 和空 writer 语义，覆盖 reader-first/writer-first 饱和 |
| 15 | daemon 已移除取消控制、最终输出仍在传输时，`onData` 调用 close 的 CANCEL 太晚，`exited` 错误地成功 | 保持 callback failure 优先，再检查本地 abort signal；已 close 则以 `RemoteError` 的 `aborted` 拒绝。延迟真实最终输出交付，在回调 close，验证终态 |
| 16 | artifact 目录含字面 `#`、`?` 或类似 percent escape 的片段时，npm raw `file:` 路径被 URL 解析改变，合法 release/check gate 失败 | 按 npm filesystem-spec 语义解析，再比较规范化绝对路径；不把字面字符当 fragment/query/escape。覆盖这些目录名，并保留拒绝真正不同 tarball 的断言 |

### Actionable Findings

全部归属 `downstream-resolver`，全部有 `suggested_fix`，全部 `requires_verification: true`。下表是调用方待办，不是已应用清单；用户要求 **16 项全部修复**。

| # | File | Issue / Response | Route | Confidence |
|---|---|---|---|---|
| 1 | `packages/coding-agent/src/experimental/services/transcript-provider.ts:327` | P1：规范化 event、snapshot 及 replay | `gated_auto -> downstream-resolver` | 100 |
| 2 | `packages/chord/src/reload.ts:805` | P1：回滚重建资源订阅 | `gated_auto -> downstream-resolver` | 75 |
| 3 | `packages/ai/src/types.ts:513` | P2：迁移两个 retained usage 聚合器 | `gated_auto -> downstream-resolver` | 100 |
| 4 | `packages/env/daemon/src/sys/windows.rs:591` | P2：恢复 cleanup 137 契约 | `gated_auto -> downstream-resolver` | 100 |
| 5 | `packages/tui/src/tui-main-screen.ts:785` | P2：逐图片绘制和清理 | `gated_auto -> downstream-resolver` | 100 |
| 6 | `packages/ai/src/api/openrouter-images.ts:196` | P2：复用 provider billing helper | `gated_auto -> downstream-resolver` | 75 |
| 7 | `packages/ai/src/telemetry.ts:67` | P2：统一 schema、调用方及生成文档 | `gated_auto -> downstream-resolver` | 75 |
| 8 | `packages/coding-agent/docs/cli.md:132` | P2：纠正 MCP allowlist 说明 | `gated_auto -> downstream-resolver` | 75 |
| 9 | `packages/coding-agent/src/core/compaction/utils.ts:68` | P2：限制嵌套结果归属到当前 assistant | `gated_auto -> downstream-resolver` | 75 |
| 10 | `packages/coding-agent/src/extensions/codemode/execute.ts:654` | P2：设计并落实持久 receipt 所有权及去重 | `manual -> downstream-resolver` | 75 |
| 11 | `packages/durable/src/codemode/output.ts:148` | P2：准备模型可见图片，原始文件不变 | `gated_auto -> downstream-resolver` | 75 |
| 12 | `packages/env/daemon/src/main.rs:439` | P2：所有 write open 可中断 | `gated_auto -> downstream-resolver` | 75 |
| 13 | `packages/env/daemon/src/pty.rs:207` | P2：加入输入 byte budget 和客户端背压 | `gated_auto -> downstream-resolver` | 75 |
| 14 | `packages/env/daemon/src/special.rs:548` | P2：饱和 rendezvous 明确拒绝准入 | `gated_auto -> downstream-resolver` | 75 |
| 15 | `packages/env/src/terminal.ts:134` | P2：终态保留本地 close/abort | `gated_auto -> downstream-resolver` | 75 |
| 16 | `scripts/local-package-install.mjs:131` | P2：按 filesystem spec 比较 npm 路径 | `gated_auto -> downstream-resolver` | 75 |

### Agent-Native Gaps

生成图片的 agent 接口可达，但 Durable 输出没有执行聊天模型图片准备，见 **#11**；不重复计数。审查抽样的七类高优先级能力均有 agent 入口，这不构成全部调用路径或运行结果证明。

### Deployment Notes

这是 SQLite v2 的操作准入清单，**不是新增产品缺陷，也没有执行部署验证**。

- **迁移前阻断条件：** 首次打开 storage 就会迁移并重建 tasks 表。先隔离全部 owner、请求、调度及 Durable Object alarms；不得混用新旧版本访问同一 storage，不得手工降低 schema version。
- **恢复证据：** Node 使用一致性完整备份，不得仅复制运行中 WAL 主文件；用旧 artifact 在隔离副本演练恢复。Cloudflare 需要 host/platform 支持的完整对象恢复点及实际恢复步骤；当前没有此项运行证据，不能宣称已可回滚。
- **放流前核对：** schema 为 `(1,2)`；完整 task 行、各表及状态计数、`next_id/next_seq` 与基线一致；不存在 `tasks_v2`；五个 task 索引完整；完整性检查通过。完成后再恢复任务，验证 sleeping/alarm 与 submission 去重。
- **回滚边界：** v2 提交后不能仅回退代码。需恢复完整迁移前快照，并处理快照之后的外部副作用。JSONL 应备份整个目录和 sidecar；IndexedDB、SessionRepo 不适用 Durable SQL 命令。
- **观察重点：** 初始化/schema/锁错误、`session_failed`、任务唤醒及 alarm、重复提交、存储增长和启动延迟。详细可执行清单在 run artifact `deployment-verification-agent-full.md`。

### Coverage

**验证结果**

| 项目 | 结果 |
|---|---|
| 单个 fresh validator batch | #1-#16，全部 confirmed |
| confirmed / rejected / unresolved | 16 / 0 / 0 |
| malformed / failed / shortcut-skipped | 0 / 0 / 0 |
| omitted / degraded blockers | 0 / 0 |
| 严重性及置信度变更 | 无 |
| 产品修复、测试、构建、lint、安装、provider 调用、提交 | 本审查均未执行 |

- **明确偏差：** 原合成文件仍写着 cap8、只选 #1-#8；已更新为实际单批 16 项及零遗漏。为满足 fix-all，批次从正常上限 8 扩展到所有 P1/P2，这比通常仅为超量 P0/P1 扩容更宽；没有第二批或隐藏待验证队列。validator 在 15 分钟内返回。
- **受保护主题：** `public-contract` 为 #1/#3/#4/#6/#7/#8/#9/#11/#15/#16；`concurrency` 为 #2/#10/#12/#14；#5/#13 为 `null`。无保护主题重分类。每项精确原因及 subject 原样保留在 `synthesized-findings.json`、`review.json` 和 `actionable-findings.json`。
- **发生率限制：** validator 检查了触发条件及可达调用方/fixture，没有执行复现或测量生产发生率。已有测试源码不是本轮通过回执；此前 suite receipts 不作为当前代码证明。
- **来源与置信度：** #1、#10 来源仅为迟到补充证据，原 `independent_reviewers` 保持空；本轮 fresh validation 确认其具体问题，但不追认原 reviewer 按时返回，也不因此上调置信度。
- **筛选结果：** 0 confidence suppression、0 malformed finding/return、0 quote-gate demotion、0 soft-bucket demotion、0 semantic deduplication、0 pre-existing finding。一次 evidence backfill 保留累计值 1；agent-native 的 prose/JSON 同一问题只入集一次。未应用额外 review policy 或 pack。

**覆盖边界**

| 分区 | 分配路径 | 源 artifact 标记 semantic / insufficient | 时效 |
|---|---:|---:|---|
| AI | 192 | 79 / 113 | 按时 |
| agent | 53 | 53 / 0 | 按时 |
| Chord recovery | 145 | 42 / 103 | 新 recovery 按时 |
| Durable | 205 | 85 / 120 | 迟到，仅补充 |
| env | 44 | 44 / 0 | 按时 |
| session | 105 | 75 / 30 | 按时 |
| integrations | 112 | 105 / 7 | 迟到，仅补充 |
| interactive | 107 | 85 / 22 | 按时 |
| tooling | 260 | 160 / 100 | 按时 |
| docs | 40 | 21 / 19 | 按时 |

- 十个分区清单覆盖全部 1,263 个路径，但**清单覆盖不等于每个 hunk 都完成语义审查**。上表的 semantic 数是源 artifact 自述，迟到项不得计为及时独立覆盖。生成 catalog 通过 generator、manifest 和代表输出检查，native/vendor/platform 仍有不足。
- host 一次阻塞等待到 22m55s 才返回，超过每 reviewer 20 分钟上限。原 correctness-chord 被取消且无完整 artifact；Durable、integrations、api-contract 的迟到材料只作补充。Durable 的空 finding 返回不提供 clearance。
- fresh Chord recovery 在 8m23s 返回，本地 adversarial fallback 在 10m16s 返回，各自满足上限；仅 recovery 提供本次恢复的 Chord 语义覆盖，不能追认原任务。
- 图索引停留在 2026-10-09 且未 watch；四个抽查文件显示 `metadata_changed` 或 `not_tracked`。结论依赖当前源码、LSP 和针对性历史，不声称穷尽 graph/dynamic callsite。
- 没有找到指定 `CODING_STANDARDS.md` 或 base `REVIEW.md`；提供的 AGENTS 规则仍生效。历史 review ledger 正文没有作为本轮证据。
- 审查源码快照 SHA-256：`efd2919e6d61eec10a918a8fcf0b06ff9217b027bee3abde31f8b46f1fbff875`。报告针对该快照，不替后续修复背书。

**Cross-model peer**

adversarial lens: in-process fallback (cross-model peer not run: Claude ACP authentication failed: OAuth session expired and could not be refreshed)

| 身份字段 | 本轮值 |
|---|---|
| `model_requested` | `claude-opus-5-5` |
| `effort_requested` | `high` |
| `receipt_supported` | `false` |
| `model_actual` | `unverified` |
| `effort_actual` | `unverified` |
| `independence_verified` | `false` |

没有可用的外部 peer artifact，不能声称 Claude 已完成审查或获得跨模型一致意见。旧 peer receipts 不证明本轮身份。未验证的实际模型/effort 保持未验证，不能由请求值推导。

**剩余风险及测试缺口**

- Chord Windows prebuild 未执行或二进制审计；源码审查不证明 source-to-binary 一致或 Windows 运行兼容。
- legacy-v3 compaction 的 `systemMessage` 保留及重复 retained-tail system 消息移除，缺少迁移专项断言。应覆盖完整 checkpoint、retained system delta、只读打开、首次 v4 升级、reopen，以及自引用 `firstKeptEntryId` 的空 tail。
- `scripts/issues/ui.test.mjs:14-29` 的模拟 focus/pointer/innerHTML 不代替真实 DOM。应覆盖 deferred poll 后键盘 select-to-select，以及 priority/retriage/bulk 控件的 pointer 事件顺序；本轮未进行浏览器验证。

**Artifacts:** `/tmp/compound-engineering-501/ce-code-review/20261103-220022-ea02c906/`，包含更新后的 synthesis、validator 输入/逐项 verdict/outcome、完整 `review.json`、`actionable-findings.json`、`advisory-outputs.json`、`metadata.json` 及 stage log。report stage 已记录并执行 summarize；markdown 由调用方保存。

---

### Verdict

> **Not ready**
>
> 仍有 2 项 P1 和 14 项 P2 未修复。用户明确要求 fix all，因此不能仅完成评审或只清 P1 就判定完成。先修 transcript 丢事件及 Chord 回滚订阅，再处理计费、输入/并发契约和其余问题；全部修复后由调用方执行针对性及集成检查，保存同一 review 文档并提交，不 push。本报告不是这些修复或检查的完成证明。

**Actionable Findings recap** — 以下全部有 `suggested_fix`，归属 `downstream-resolver`，修改后需要验证：

1. **#1 P1** `packages/coding-agent/src/experimental/services/transcript-provider.ts:327` — 修复严格 JSON 发布丢工具事件；`gated_auto`；confidence 100。
2. **#2 P1** `packages/chord/src/reload.ts:805` — 回滚重开资源后重绑监听；`gated_auto`；confidence 75。
3. **#3 P2** `packages/ai/src/types.ts:513` — 保留 retained usage 的实付来源；`gated_auto`；confidence 100。
4. **#4 P2** `packages/env/daemon/src/sys/windows.rs:591` — Windows cleanup 返回 137；`gated_auto`；confidence 100。
5. **#5 P2** `packages/tui/src/tui-main-screen.ts:785` — 绘制并清理每张 overlay 图片；`gated_auto`；confidence 100。
6. **#6 P2** `packages/ai/src/api/openrouter-images.ts:196` — 采用 OpenRouter 图片真实账单；`gated_auto`；confidence 75。
7. **#7 P2** `packages/ai/src/telemetry.ts:67` — 统一公开 AI telemetry schema 及文档；`gated_auto`；confidence 75。
8. **#8 P2** `packages/coding-agent/docs/cli.md:132` — 纠正 direct MCP allowlist 承诺；`gated_auto`；confidence 75。
9. **#9 P2** `packages/coding-agent/src/core/compaction/utils.ts:68` — 防止失败 assistant 继承旧 call ID 归属；`gated_auto`；confidence 75。
10. **#10 P2** `packages/coding-agent/src/extensions/codemode/execute.ts:654` — 建立跨脚本终止的持久 receipt 所有权及去重；`manual`；confidence 75。
11. **#11 P2** `packages/durable/src/codemode/output.ts:148` — 按聊天模型限制准备 inline 生成图；`gated_auto`；confidence 75。
12. **#12 P2** `packages/env/daemon/src/main.rs:439` — 写 open 全程可中断；`gated_auto`；confidence 75。
13. **#13 P2** `packages/env/daemon/src/pty.rs:207` — 限制 pending 输入并向客户端传递背压；`gated_auto`；confidence 75。
14. **#14 P2** `packages/env/daemon/src/special.rs:548` — FIFO helper 饱和时明确拒绝准入；`gated_auto`；confidence 75。
15. **#15 P2** `packages/env/src/terminal.ts:134` — 最终输出阶段仍尊重本地 close；`gated_auto`；confidence 75。
16. **#16 P2** `scripts/local-package-install.mjs:131` — 用 filesystem-spec 语义处理 npm 本地路径；`gated_auto`；confidence 75。

## Current repair execution checkpoint

The user authorized fixes for all16 validated findings and a local commit, including the previously reviewed dirty workspace. Initial report above remains the pre-repair record. The parent observed failing regressions before production integration: strict-JSON transcript loss; rollback stale emitters; Agent/Durable usage provenance; OpenRouter image charges; canonical telemetry; multiple overlay image placement/crop/cleanup; nested-file ownership; generated inline image limits/reopen; raw npm file paths; FIFO replacement/saturation; terminal input admission and close during final output. The initial late-usage early-return fixture also had an independent tool-exposure mistake; after correcting that fixture, all4 return/abort classifier/image cases fail specifically because expected costs .001/.04 remain0. The tests reopen the exact captured session file.

The first integrated billing slice (#3/#6) passed its regressions: AI13, Agent12, Durable12. Native Windows #4 remains source-confirmed and has a platform regression prepared; native Windows execution is unavailable. Docs #8 uses existing MCP runtime behavior rather than a source-text test. No assertion, timeout or test exclusion has been weakened.

Test preparation and production integration were separate. Parent-owned red runs are recorded in `repair-evidence.json` under the review run. File assignments were disjoint, but an intervening test-fixture correction by the parked late-usage worker caused one stale edit rejection; the parent stopped editing, reread and attributed that change, and did not overwrite it. Broad broadcasts also woke retired proof workers; those sessions were retired and later messages targeted explicit owners. No worker ran build/check/format/install/generation or wrote the git index. The shared dirty-worktree staging, broad worker waves, and same-unit proof-worker continuation are procedural deviations, not clean-baseline isolated execution. Production repairs subsequently used fresh bounded contexts, with parent-owned integration and verification. No commit or push has occurred yet.

## Applied repairs and integrated verification

This disposition supersedes the un-applied queue above for the repaired local tree, without changing its source-validation reasons or claiming uniform whole-merge coverage.

| Findings | Applied behavior and evidence boundary |
|---|---|
| #1 | Strict-JSON normalization now precedes initial/resnapshot publication and shared reducer/replay event insertion. Actual bash, absent-details, routed replay and resnapshot regressions pass. |
| #2 | Displaced-resource listeners detach before close and rebuild against restored values before gated replay and task restart. Fresh-emitter rollback regression rejects stale events while preserving unaffected subscriptions. |
| #3/#6 | OpenRouter image usage applies tier-aware catalog fallback and the existing non-BYOK/BYOK reported-cost helper. Agent and Durable aggregators preserve all-contributing-charge provenance and neutral empty accumulators. |
| #4 | Windows job termination uses 137 while preserving saved normal leader status. Native Windows regression is included; cross-target all-targets typechecking passed, native execution remains unavailable. |
| #5 | Every overlay placement has independent geometry/cropping and complete cleanup IDs, including adjacent and CUF-separated chunked images. Geometry projection omits image payloads before prefix measurement. Terminal-cell/protocol tests pass; native image pixels are not certified. |
| #7 | Retained Agent AI telemetry imports canonical pi-ai schema; typed request/poll callers and generated reference migrated. Harness schema remains independent. |
| #8 | CLI guide now distinguishes indirect, direct and hidden MCP exposures and does not promise tool_search can activate unlisted direct tools. Existing MCP behavior remains unchanged. |
| #9 | Codemode file attribution resets on every assistant/user boundary, but survives transparent system patches and sibling results. Compact/branch invalid-ID-reuse regressions pass. |
| #10 | An explicit private definition capability binds fresh invocation-local receipt recorders to the original SessionManager and dispatch parent. No WeakMap or public ExtensionToolContext billing API. Receipts persist independently exactly once; model usage is excluded from tool aggregate to prevent duplicate charges. Notifications require original runtime/manager ownership. `appendUsageAt` validates historical parents and uses existing atomic rewrite while preserving selected leaf. Memory/persisted/reopen, unknown parent, write/fsync/rename failure, late return/abort, reload/disposal and definition reuse regressions pass. |
| #11 | Durable saves original image bytes, then prepares inline attachments through existing ImageProcessor using conversation limits. Without a processor, incompatible inline data is omitted with persisted diagnostics; saved originals remain usable. Stored-result/next-request/reopen regressions pass. |
| #12/#14 | Every Unix wire writer open uses interruptible helpers; metadata-to-FIFO replacement cannot strand ordinary workers. Saturated reader/writer rendezvous pools fail admission explicitly with EMFILE; admitted requests remain cancellable. Both native real-reactor regressions pass. |
| #13/#15 | PTY admission is bounded to4MiB including the active buffer; drop/rejection refunds reservations. `RemoteTerminal.write` is awaitable, sequentially admits chunks, rejects concurrent writes without a JS queue, and all repository callers migrated. Final-output close preserves aborted outcome after callback-error precedence. Public docs record the clean cutover. |
| #16 | npm `file:` lock resolutions use raw filesystem semantics, preserving literal #/?/% while rejecting different artifacts. Real offline npm consumer tests pass. |

Targeted integrated runs: coding-agent117, Chord95, TUI181, Durable25, Agent18, Env85 passed with5 platform skips, local package consumers9. Counts overlap and are not summed. Native Rust42 passed; Windows all-targets cross-check and Clippy `-D warnings` passed using external targets. Offline build bg_47 passed (76 bundle files,9.4MiB). Initial check exposed owned typing errors and formatting; those were corrected rather than suppressed.

Actual loopback/native smoke observed OpenRouter image cost0.125 with reported provenance, historical receipt persistence with unchanged selected leaf after reopen, terminal EAGAIN and close-aborted. A second terminal smoke waited for explicit READY from the raw nonreading program before writing; it again observed `{ready:true,rejected:"EAGAIN",closed:"aborted"}`. Synthetic local HTTP only, no paid/live provider request. Temporary programs removed after evidence capture.

The first full isolated suite bg_48 finished **13644 passed,1 failed,945 skipped** (`artifact://234`), not a passing receipt. Its sole failure exposed a pre-existing v1 migration bug: generated IDs were never reserved in the collision set. A controlled UUID collision deterministically produced an entry with id=parentId. The new permanent migration regression failed before `ids.add(entry.id)` and passed afterward; migration/large-session tests passed52 with2 existing skips. Baseline blame identifies the missing reservation before merge8322aa1d, not an `appendUsageAt` regression. No generic traversal limit hides the cycle. Final corrected full-suite/build/check receipts are pending below.

Five read-only simplification lenses completed. Reuse/test-value found nothing worth changing. Applied behavior-preserving changes: remove the resize-only generic wrapper, expand provenance branches, clarify image-helper responsibility, avoid rescanning prior base64 uploads for overlay geometry. All proof tests remain unchanged by simplification. No manifest/lockfile change or feature-branch changelog entry is intended. No commit or push yet.

## Independent repair-edge review and corrected epochs

Three fresh read-only closure reviewers checked the integrated repairs. They source-closed the other assigned boundaries but rejected initial closure of #10, #5's iTerm2 variant, and #12's ordinary-descriptor handoff. These are repair edges, not additional numbered original review findings:

- **#10 same-file/retry:** capturing an old manager is insufficient after a distinct manager resumes the same file; stale full-history rewrites can erase newer messages, and atomic storage rejection leaves a delivered receipt without retry ownership. Fourteen new regressions (both model operations, same-file owner replacement, actual write/fsync/rename failures) failed before correction. The correction is receipt-specific explicit file-owner adoption plus retained queue, not a public extension billing API or periodic retry system. Original manager/runtime notification fences remain required.
- **#5 iTerm2:** each iTerm2 record still owned the full source row and replayed the first image twice. Two-iTerm2 and raw mixed Kitty/iTerm2 row regressions both failed with first-payload count2 instead of1; each record now owns only its image span plus required upward anchor. Full terminal-image/tui-render run passed183. Capabilities select encoder defaults, not whether a custom raw overlay row may contain multiple protocol commands.
- **#12 regular descriptor:** all opens were cancellable, but initial ordinary-file payloads still ran synchronously on the single stream reactor. A private test gate at the actual descriptor-write boundary proved unrelated stream completion/cancellation stalled; the new native regression failed before correction. The opened ordinary descriptor must hand back to bounded file workers, while special writes remain reactor-owned.

Intermediate corrected root bg_55 passed **13646/0/945**, exit0,263.95s (`artifact://257`), but it predates these repair-edge corrections and is superseded, not final source clearance. Build bg_56 passed76files/9.4MiB,18.37s; check bg_57 passed1986files,No fixes applied,31.47s for that same intermediate source epoch. No original finding is considered closed merely because that suite was green. Final receipt-owner/reactor fixes and final integrated verification remain pending.

### Repair-edge corrections

The #10 replacement/retry matrix failed14 before implementation, then passed with the related original branch/reload/disposal/atomicity cases (**106 passed** across4 files). Receipt persistence now uses a private file-and-session-specific queue with explicit AgentSession owner adoption, weak ownership references and data-only pending charges. Delivery clones/enqueues before attempting storage, resolves the current adopted owner, and removes a charge only after successful publication before notification. Existing persistence flushes retry retained charges without another provider call. With no active owner, a freshly loaded manager publishes; the prior manager is refreshed from disk rather than used to rewrite stale state. `setSessionFile` actually reloads entries/indexes; it does not adopt receipt ownership. Same-file new history, selected branch, subsequent atomic rewrite and exact-once receipt/reopen assertions pass. Failed charges are retained only within the process; this is not a crash-durable queue.

The #12 ordinary-descriptor regression failed because a blocked regular write prevented stream cancellation/completion. Opened ordinary writers now transfer unchanged to a fixed16-worker pool with bounded4096 admission; completions wake the reactor, and stream descriptors stay reactor-owned. Native Rust **43 passed**, including the newly introduced blocked-write regression. The current daemon built successfully in an external target; no protected in-repository Cargo target was written. Windows cross-target all-targets checking and Clippy remain passing; native Windows execution is still unavailable.

The #5 iTerm2 payload correction passed **183** terminal-image/tui-render cases. Original per-image spans own their bytes and only required upward movement; adjacent/CUF Kitty, multi-iTerm2 and mixed raw-protocol rows are all covered. Build bg_64 passed 76 files / 9.4 MiB in 10.89 seconds; check bg_65 passed 1986 files, No fixes applied, in 14.83 seconds. The subsequently completed frozen root suite bg_66 and final disposition are recorded below; earlier green epochs do not substitute for that receipt.

## Final local closure

The frozen corrected authoritative isolated suite **bg_66** passed: **13662 passed,0 failed,945 skipped**, exit0,278.09s; full output `artifact://275`. Exact command: `rtk proxy env PATH="/tmp/pi-fixall-6a243f805/suite-bin:$PATH" PI_ENV_DAEMON=/tmp/compound-engineering-501/ce-code-review/20261103-220022-ea02c906/cargo-target/debug/pi-env ./test.sh`. This epoch includes the same-file receipt ownership/retry, regular-writer handoff, iTerm2 payload and legacy migration collision regressions. Earlier bg_48/bg_55 receipts remain explicitly superseded above.

Final **bg_65 npm run check** passed1986files,**No fixes applied**, exit0; final **bg_64 offline build** passed all packages and produced76files/9.4MiB. Native Rust43 tests passed, Clippy all-targets `-D warnings` passed, and Windows GNU all-targets crosschecking passed; Windows tests executed zero on this host. All native output used external targets. No paid provider or real publication operation was used; runtime smoke used loopback HTTP, actual local session files and the current local daemon.

All16 original confirmed findings and the concrete repair-edge failures described above are implemented with the recorded local proof. The pre-existing v1 collision defect uncovered by the first full run is fixed centrally and covered deterministically. No unresolved actionable finding remains within the named review/repair scope. Receipt failures are retryable within the current process, not crash-durable before successful storage; native Windows/Android, production Cloudflare, native image pixels, actual hosted release overlap/publication and full release-artifact acceptance remain unverified operational gates.

The requested report did not exist and is ignored by the repository's `plans/` rule, so the user-authorized exact path is explicitly included in the local commit. The previously reviewed25 dirty files were offered together by the user; the final explicit scope includes them, the repaired sources/tests/docs, the older append-only closure and this report. No dependency manifest/lockfile or protected Cargo target is included. This local commit is authorized; no push or PR is authorized or performed.

**Final verdict: all16 validated findings repaired and locally verified, subject to the explicit platform/operational limits.** This supersedes the initial Not ready queue for the repaired local tree, not the disclosed review collection deviations or partial semantic coverage. No unconditional every-hunk or deployment-platform clearance is claimed.

## Code Review Results - Round 2

**Scope:** `98dfe28cbeec4e1f2f61516e227420b2407dcdf9` -> `2b0d2c5bb755c94008494ed4180edecae8c0843f`，覆盖 merge `8322aa1d` 及之后全部修复，非仅审查报告文件。共 1,272 路径、199,311 变更行，其中 73,912 可执行非测试行、47 个删除路径。
**Intent:** 集成 upstream 1.4.0，同时保留 Crystal 历史编辑、删除、恢复、shred、id0、Harness/experimental/client 消费方及计费、多模态和摘要预算语义。
**Mode:** `markdown report-only`，`depth:full`。本叶不应用修复；调用方修复、验证并本地提交后仍须继续完整范围审查。

**Reviewers:** 五个 correctness 分区分别检查 models/native/history/execution/surface；security 检查信任与授权，reliability 检查异步生命周期，api-contract 检查保留及发布接口，data-migration 检查 SQLite/v3 转换，testing 检查验证防线，performance 检查执行成本，maintainability 检查集成维护性，agent-native-reviewer 检查工具可达性，julik-frontend-races 检查真实 DOM 交互，deployment-verification-agent 检查破坏性 schema v2 上线，adversarial 提供跨模型失败后的本进程替代视角。15 个本地视角及替代视角均已收集；另一个新验证者检查全部六项。

### Triage Groups

| Group | Findings | Context | Preferred Resolution | Why |
|---|---|---|---|---|
| 回执持久化与历史，apply-queue | #1, #2, #4, #5 | 晚到回执同时影响父节点存活、历史选择、持久化成本和 v3 导入 | 先 #2，随后 #5、#4，再以 #1 覆盖实际生产格式；每项保留独立回归 | 同一生命周期的不同缺陷，不能用其中一个修复替代其余项 |

### P1 -- High

| # | File | Issue | Reviewer | Confidence |
|---|---|---|---|---|
| 1 | `packages/agent/src/harness/session/jsonl/legacy-v3.ts:228` | 新写入的独立 usage 回执使 v3 会话无法导入 | data-migration | 75 |
| 2 | `packages/coding-agent/src/core/tool-usage-binding.ts:133` | shred 调用父节点后，晚到回执堵塞后续计费和提示词准入 | correctness-history, reliability, adversarial | 75 |

- **#1:** `appendUsageAt()` 在版本 3 文件中写入 `type: usage`，导入器却拒绝该类型；带有已付费工具回执的会话在打开或 fork 时抛错。**修复:** 完整支持 usage 记录解析、经父节点解析对话谱系和叶节点、累计去重费用，不把回执当作对话节点。增加真实生产者写入后 open/fork/upgrade/reopen 的回归，断言所选上下文不变、费用恰好一次。**validation_status: confirmed；validation_reason:** 已检查生产者和导入路径，触发前提为 v3 文件含此回执；发生率未测量。
- **#2:** provider 忽略取消而晚到时，用户可能已永久 shred 原 dispatch 父节点。`appendUsageAt()` 因父节点不存在而抛错，FIFO 队首不移除，下一次 prompt 在准入前再次 flush 并失败；费用无法落盘，后续操作持续受阻。**修复:** dispatch 时捕获祖先链，原父节点不存在时附到最近仍存活的原祖先，否则附到 null；不得挂到当前分支或复活已 shred 内容。覆盖 abort -> shred -> provider 返回、同文件 manager adoption、恰好一次计费及后续 prompt 成功。**validation_status: confirmed；validation_reason:** 已检查晚返回测试源码、shred 入口和准入 flush；该交错发生率未测量。三位本地审查者一致指出同一缺陷，不构成跨模型证据。

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence |
|---|---|---|---|---|
| 3 | `packages/chord/src/host.ts:1230` | 安装已关闭连接后，既有远程引用无法随下次重连恢复 | correctness-native | 100 |
| 4 | `packages/coding-agent/src/core/session-manager.ts:1752` | 每个模型回执都同步重写整份会话 | performance | 75 |
| 5 | `packages/coding-agent/src/core/session-manager.ts:1752` | 晚到回执分支被 swipe 导航误选为对话尾部 | correctness-history | 75 |
| 6 | `scripts/issues/ui.html:82` | 轮询替换键盘焦点控件，吞掉 Space 激活 | julik-frontend-races | 75 |

- **#3:** 已断开的 `IpcLink` 在 Connection 构造中同步执行清理，`connect()` 随后仍安装它并重新 hold 绑定。下次正常连接因绑定已有 hold 而跳过，旧引用持续失效。**修复:** `#addConnection()` 返回后，仅在 `connection.open` 时设置 upstream 并重新 hold；失败时保持绑定分离。回归覆盖已有引用 -> 断开 -> 已关闭链接 -> 活链接，验证原引用恢复。**validation_status: confirmed；validation_reason:** 已检查同步关闭及后续重连的 guard，发生率未测量。
- **#4:** 文档允许逐项 `Promise.all` 分类，每个 usage 回调却调用 `_commitEntries()`，重建全部索引、序列化全部历史和图片、同步写入/fsync/替换文件。成本随完整会话大小和回执数量增长，阻塞主事件循环。**修复:** 将 usage + 保留原选择的 leaf checkpoint 作为可回滚追加事务；沿用写前长度和失败截断纪律，持久化成功后再发布索引及条目，保留所有权、重试和耐久语义。**validation_status: confirmed；validation_reason:** 已检查逐项调用及全文件重写路径；实际延迟和发生率未测量，未做性能基准。
- **#5:** 晚到回执在 dispatch 父节点下形成较新的 sibling leaf。切回 swipe 版本时，导航按最新叶时间选择，可能选中回执而隐藏实际工具结果、最终答案及后续对话；这不是已证明的磁盘删除。**修复:** 有真实对话延续时，不让 usage-only 侧枝参与对话尾部竞争，同时保留正常状态/策略尾部。覆盖 detached 付费调用、完整后续对话、替代版本、晚到回执以及来回切换。**validation_status: confirmed；validation_reason:** 已检查晚返回支持和无 usage 过滤的导航，发生率未测量。其修复不能替代 #4。
- **#6:** 八秒轮询只保护活动指针和聚焦的 select。刷新若落在按钮 Space keydown/keyup 之间，会删除激活目标并丢失决策，也会移除其他键盘焦点。**修复:** 对 `#main` 内聚焦的交互后代延迟 snapshot/render，focusout 稳定后再 flush；保留显式提交时禁用控件的 render。用真实 DOM 验证轮询穿插 Space 操作仍只提交一次且空闲轮询不丢焦点。**validation_status: confirmed；validation_reason:** 已检查 render 和键盘处理路径，浏览器发生率未测量；现有普通属性 mock 不验证原生焦点/激活行为。

### Actionable Findings

以下六项全部已确认、均交由调用方处理；本轮没有已应用修复。所有项目均有 `suggested_fix` 且 `requires_verification:true`。

| # | File | Issue | Route | Notes |
|---|---|---|---|---|
| 1 | `packages/agent/src/harness/session/jsonl/legacy-v3.ts:228` | P1，接收并正确迁移独立 usage | `gated_auto -> downstream-resolver` | 持久格式兼容；75 |
| 2 | `packages/coding-agent/src/core/tool-usage-binding.ts:133` | P1，恢复已删除 dispatch 谱系的回执归属 | `manual -> downstream-resolver` | 审核祖先回退方案后修复；75 |
| 3 | `packages/chord/src/host.ts:1230` | P2，拒绝安装关闭的 upstream | `gated_auto -> downstream-resolver` | 原引用重连回归；100 |
| 4 | `packages/coding-agent/src/core/session-manager.ts:1752` | P2，以耐久追加取代逐回执全量重写 | `gated_auto -> downstream-resolver` | 验证失败回滚和选择不变；75 |
| 5 | `packages/coding-agent/src/core/session-manager.ts:1752` | P2，swipe 不选择 usage-only 侧枝 | `gated_auto -> downstream-resolver` | 验证完整对话恢复；75 |
| 6 | `scripts/issues/ui.html:82` | P2，轮询保护键盘焦点和激活 | `gated_auto -> downstream-resolver` | 真实 DOM 回归；75 |

### Deployment Notes

此处是发布前提，不是额外产品缺陷；目前缺少运维证据，**上线 NO-GO**。

- 打开 SQLite storage 就会自动执行 v1 -> v2 迁移，先停止全部 writer/scheduler/旧实例，记录每个数据库或对象的原 prefix。不得把启动新应用当作无副作用检查。
- Node 用 SQLite backup 机制取得并校验备份，不能仅复制可能依赖 WAL 的主文件；Cloudflare 需记录对象、恢复点、保留期限并在一次性对象演练恢复。升级前记录 integrity、schema version、metadata、各表及状态计数、task 全部七列和五个索引定义。
- 先用备份副本测迁移时间、空间/WAL 峰值，并在实际 `DROP TABLE`/rename 序列中注入失败，证明每个部署后端都恢复行、索引及版本。当前审查没有执行这些操作。
- 仅打开 storage 迁移，保持任务处理关闭；比对 `durable_schema.version = 2`、`PRAGMA integrity_check = ok`、`tasks_v2` 不存在、五个索引及其定义正确。对 task 七列和其他原有表做双向 `EXCEPT`，差异均应为零；counts 和 `next_id`/`next_seq` 不变后再恢复处理。
- 回退到 1.3.0 或更早需要恢复升级前数据库，不可只回滚代码或降版本号。恢复会丢弃备份之后的写入，且不会撤销外部工具/模型副作用；恢复处理后必须先对账。旧 JSONL runtime 也不能恢复 sleeping task。
- 启用时及 +1h/+4h/+24h 检查 migration/storage-open、`session_failed`、`migration_failed`、`task_parked`，跟踪 sleeping deadline 和 submission 进度，验证 canary 重启后恢复且无重复副作用。Node `synchronous=NORMAL` 不保证最新提交抗掉电；Cloudflare 依赖平台事务和恢复能力，自定义 adapter 仍须满足事务契约。

完整清单及未执行的查询示例见本轮 `deployment-verification-agent.md`。

### Coverage

- 本轮是独立新一轮完整范围审查，未用历史报告播种。8 个原始候选合并了同一 deleted-parent 缺陷的 2 个重复，剩余 **6 项全部确认**；既有问题 0、confidence suppression 0（anchor 50/25 均 0）、软降级 0、malformed 0、quote gate 降级 0、first-evidence backfill 0。没有遗漏候选或 cap 跳过。
- 一批验证覆盖 #1-#6，结果在界限内到达：confirmed 6、rejected 0、unresolved 0、malformed 0、failed 0、shortcut-skipped 0。**全部是独立源码验证，发生率均未测量；不是运行复现。** #3 保留本叶事先判定的 concurrency 保护，虽验证者填 null；#5 由验证者增加 concurrency 保护。#1 为 public-contract，#2/#6 为 concurrency；不改变严重度或置信度。
- 1,272 条路径全部入账，但不是逐 hunk 放行。完整语义审查/证据不足分别为 models 19/248、native 61/109、history 19/91、execution 57/245、surface 39/384；合计 **195/1,077**。过期且未监控的图索引不作完备性证据；使用当前源码检索，未穷尽动态、外部消费方或删除模块的存活性，未执行/比对 Windows 预编译二进制。
- 本地 15 个视角及 adversarial fallback 均终态收集，无失败、超时或 malformed；并发上限 5。部分研究超过目标时间，但未超过收集界限。适用 AGENTS 仍约束审查，未增加未指定标准；review policy 移除/重分级 0，settlement suppression 未评估。
- adversarial lens: in-process fallback (cross-model peer not run: Claude ACP authentication failed: OAuth session expired and could not be refreshed)
- Peer 身份：`model_requested=claude-opus-5-5`、`effort_requested=high`、`receipt_supported=false`、`model_actual=unverified`、`effort_actual=unverified`、`independence_verified=false`。跨模型没有完成审查，也未折入 peer artifact；本进程 fallback 不授权验证捷径。调度方记录 peer job 目录已删除。
- 本审查及报告叶未运行 tests/build/lint/install/provider/browser，不做源代码或仓库文档修改。本叶只消费本轮交接、合成及六项 verdict；独立验证者读取源码。以往绿色结果不能证明本轮缺陷或修复。
- Agent-native 抽样的 6/6 高优先级能力可通过 agent 接口使用，未建立新的可执行缺陷，不代表全量清除。测试缺口另有：packed runtime smoke 不编译隔离的 TypeScript SDK 声明消费者；真实 v2 DROP/rename 中途失败的逐后端恢复演练未做。生产备份、容量、恢复证据仍缺失，属于上述发布门槛，不计入新增产品发现。
- 机器结果位于 `/tmp/compound-engineering-501/ce-code-review/20261104-021452-r2-e6183e7d`：`review.json`、`final-findings.json`、`actionable-findings.json`、`advisory-outputs.json`、`metadata.json`；原始验证理由完整保留。调用方将本报告追加到同一审查文档。

---

### Verdict

> **Not ready.** 本轮新增并确认 2 项 P1、4 项 P2，六项均未修复，尚未满足“新一轮完整范围审查零新增且无未验证遗漏”的收敛条件。
>
> **首要动作:** 先修复 #2 的回执队首永久阻塞，并处理 #1 的 v3 导入失败；完成其余四项及相应验证、本地提交后继续完整范围审查。发布另受部署门槛约束。

**Actionable Findings - 优先队列**（全部 `suggested_fix: present`，owner 均为 `downstream-resolver`）：

1. **#2 P1** `packages/coding-agent/src/core/tool-usage-binding.ts:133` - 晚到回执引用已 shred 父节点，持续堵塞准入；`manual`，采用原谱系存活祖先回退并验证，confidence 75。
2. **#1 P1** `packages/agent/src/harness/session/jsonl/legacy-v3.ts:228` - 独立 usage 破坏 v3 导入；`gated_auto`，补齐解析、谱系和去重计费回归，confidence 75。
3. **#5 P2** `packages/coding-agent/src/core/session-manager.ts:1752` - swipe 被回执侧枝截短；`gated_auto`，保留真实对话尾部，confidence 75。
4. **#4 P2** `packages/coding-agent/src/core/session-manager.ts:1752` - 逐回执同步重写整会话；`gated_auto`，改为可回滚耐久追加，confidence 75。
5. **#3 P2** `packages/chord/src/host.ts:1230` - 关闭链接污染重连绑定；`gated_auto`，仅安装仍 open 的连接，confidence 100。
6. **#6 P2** `scripts/issues/ui.html:82` - 轮询丢键盘焦点/激活；`gated_auto`，延迟交互中刷新并补真实 DOM 回归，confidence 75。

Artifacts: `/tmp/compound-engineering-501/ce-code-review/20261104-021452-r2-e6183e7d`。


## Round 2 repair disposition

All six confirmed findings are implemented. This closes the Round 2 repair queue, not the required subsequent independent full-range review.

| Finding | Repair | Observed local proof |
|---|---|---|
| #1 v3 standalone usage | Parse and index usage as state-only nodes, resolve ancestry/selection through them, and include deduplicated charges in the existing import adjustment. | Three producer-written cases failed with `Unsupported legacy v3 record type: usage` before repair. Complete migration file: 55 passed. Standalone source-runtime producer -> importer -> upgrade smoke: version 3, 12 tokens, cost 0.03, two context messages. |
| #2 shredded dispatch lineage | Capture original ancestor IDs at dispatch; resolve the nearest survivor against the current writer on every drain attempt, otherwise null. | Eight classifier/image, current-manager/same-file adoption cases failed before repair. Complete codemode suite now passes, including exactly-once reopen, no shredded-node resurrection, and subsequent prompt admission. |
| #3 closed upstream reconnect | Install and re-hold only if the newly constructed connection remains open. | Original reference stayed `loading` in the red regression. Complete link suite: 25 passed. Standalone source runtime: original reference `live`, replacement counter 1 after disconnected IPC then live reconnect. |
| #4 per-receipt full rewrite | Persist usage plus selected-leaf checkpoint in one rollback-protected fsynced append batch; publish memory only after success. Initial file publication may still serialize setup history. | Five append/rollback tests failed before repair. Transaction suite passes partial receipt/checkpoint/batch writes, fsync failure, rollback quarantine/repair, retries and reopen. Source-runtime smoke appended 100 receipts to 2,000,966 historical bytes, wrote 33,900 additional bytes, serialized zero historical entries, preserved selection and reopened 100 charges; 1,071.5 ms on this machine, not a throughput benchmark. |
| #5 swipe receipt side branch | Ignore terminal receipt-only branches while retaining state/policy and continuations through receipts; restore selected policy at runtime without appending a new policy child. | Two detached classifier/image swipe cases failed before repair. An intermediate failure was traced to policy restoration appending a child of the correctly selected policy leaf; runtime-only restoration fixed it without changing assertions. Both cases include reopen and full projection/branch equality. |
| #6 keyboard focus/poll | Defer background snapshot/render/flush while an interactive main descendant is focused; flush after focus settles outside. Explicit decision render still disables controls. | UI red: 37 passed / 10 failed; green: 47 passed. Real Chromium with unchanged production 8,000-ms poll reproduced disconnected/unfocused Space target and zero decisions before repair; after repair original target remained connected/focused and keyup submitted exactly `{number:10, priority:"p0"}` once, with controls disabled. Button -> summary -> link kept issue 10; leaving main installed issue 99. Failed poll displayed 503 while preserving focused button. Native retriage/bulk Space was not separately exercised; unit sequences cover those controls. |

The four complete receipt/codemode/swipe/policy files passed 129 tests. Five adjacent swipe/history persistence files passed 92 tests. `npm run check` completed with exit 0, 1,986 files and **No fixes applied**, including TypeScript and browser-smoke; durable receipts are `check.log` and `check-exit.json` in the Round 2 run directory. Earlier check attempts exposed a TypeScript stale status narrowing; the regression now reads status through a function without weakening equality assertions. The first formatter pass changed five owned Round 2 files; the observed dirty set contains only the 12 declared Round 2 paths, no dependency/lockfile or unrelated user paths.

`npm run build:offline` completed, producing the 76-file, 9.4-MiB coding-agent bundle. Rust was unchanged this round; prior Rust/native checks are not represented as newly rerun. Actual-browser evidence is `browser-smoke.json`; append instrumentation is `receipt-append-smoke.json`. Temporary smoke scripts, browser service and tab were removed/stopped. The authoritative isolated root suite completed: **13,691 passed / 0 failed / 945 skipped**, exit 0, 341.97 seconds. `suite.log` ends with the aggregate and `suite-exit.json` records code 0. The first isolated run also completed with the same totals (400.74 seconds, `artifact://379`); the durable rerun is the authoritative retained receipt (`artifact://387`). A standalone same-file adoption smoke separately observed one receipt on the surviving original ancestor or null, selected branch retained, shredded dispatch parent absent, and a usable subsequent append (`lineage-smoke.json`).

The decoded Markdown report above preserves the original 38,907-byte report prefix (SHA-256 `a16eaaf32ecff4bae478e12246d499f9363a6e96f9ef014072a32eaba24ac8fc`). An initial JSON-wrapped append was corrected by programmatic decoding before further appends. Historical Not ready and intermediate validation receipts remain intact.


## Code Review Results

**轮次:** Round 3，`20261104-034547-r3-e61b4049`  
**Scope:** 固定第一父提交 `98dfe28cbeec4e1f2f61516e227420b2407dcdf9` -> `1da23c158f319ac39829ef13c7da557183e0637a`，覆盖 merge `8322aa1d` 及截至该 HEAD 的全部修复提交。分支为 `fix/full-merge-review-8322aa1d`；共 1,272 个变更路径、200,114 行变更、73,994 行非测试可执行变更，包含 47 个删除文件。  
**Intent:** 合入 upstream 1.4.0，同时保留 Crystal 历史、编辑、删除、恢复、shred、id0，以及 Harness、experimental/client、计费、多模态和摘要预算契约。  
**Mode:** `markdown report-only`，`depth:full`，`grouping:auto`，`apply_local:false`。本报告未应用修复，未修改源码，未运行测试、构建、lint、浏览器验证或网络请求，未创建 commit、push 或 PR。

**结论摘要:** 8 个候选全部进入同一验证批次，**7 个 confirmed，1 个 unresolved，0 个 rejected**。全部保持 P2、confidence 75。**#6 是受保护的 concurrency 验证门，既未确认，也未驳回，不进入修复队列。当前结论为 Not ready，不能宣称零新增或审查收敛。**

**Reviewers:**
- `correctness-models`、`correctness-native`、`correctness-history`、`correctness-execution`、`correctness-surface`: 分别检查模型、原生运行时、历史数据、执行链和用户界面，五个分区对全部变更路径完成一次归属。
- `security`: 信任边界和认证；`reliability`: 异步生命周期；`api-contract`: 已发布消费者契约。
- `data-migration`: SQLite 和旧格式转换；`testing`: 测试是否真正区分目标故障；`performance`: 增量更新、转换和 fanout 成本。
- `maintainability`: 合并后的结构集成；`agent-native`: 工具和程序化能力可达性；`frontend-races`: DOM 更新和交互时序；`deployment`: 破坏性迁移和回滚。
- `adversarial`: 外部跨模型调用认证失败后的进程内替代审查，**不构成已验证的跨模型独立佐证**。

### Triage Groups

| Group | Findings | Context | Preferred Resolution | Why |
|---|---|---|---|---|
| 延迟计费回执与会话分支，apply-queue | #3, #5 | 回执所属会话和导出导航各有独立缺陷 | 先修 #5，保留退出中内存会话的回执接收对象；再修 #3，避免默认导航落到纯计费叶节点 | 保存计费记录和保持对话选择都需要完成，两项不能互相替代 |
| Issue UI 刷新与用户交互，apply-queue | #7, #8 | 刷新既要完成已提交决策，也不能销毁选中文本 | 先修 #7，区分决策完成与普通焦点延迟；再修 #8，加入 selection 保护或保留稳定 DOM | 两者共享刷新保护逻辑，但触发状态和回归断言不同 |

#1、#2、#4 是独立修复项。#6 单独作为 verification gate，不授权按候选修复方案修改实现。

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence |
|---|---|---|---|---|
| 1 | `packages/agent/src/harness/pico3/chord.ts:347` | 原生 Pico 流式镜像反复比较完整增长字符串，产生额外二次成本 | performance | 75 |
| 2 | `packages/chord/test/manager.test.ts:176` | Windows parent-loss 测试使用无效描述符布局，无法独立验证目标保护 | testing | 75 |
| 3 | `packages/coding-agent/src/core/export-html/template.js:171` | 导出导航选中延迟回执叶节点，隐藏后续对话 | correctness-history | 75 |
| 4 | `packages/coding-agent/src/core/model-runtime.ts:789` | 保留的 ModelRuntime 调用绕过已公开承诺的请求遥测 | correctness-models | 75 |
| 5 | `packages/coding-agent/src/core/tool-usage-binding.ts:130` | 内存会话 fork 后，原会话的延迟付费回执失去接收对象 | correctness-history | 75 |
| 6 | `packages/coding-agent/src/experimental/client-runtime.ts:252` | 未决: 旧 attach 失败清理是否能释放新 attach 的能力引用 | adversarial | 75 |
| 7 | `scripts/issues/ui.html:243` | 获得焦点的决策按钮阻塞自身刷新，后续决策被持续忽略 | frontend-races | 75 |
| 8 | `scripts/issues/ui.html:250` | 后台刷新替换文本节点，销毁用户已选中的 issue 文本 | frontend-races | 75 |

**#1: 原生 Pico 镜像丢失已知 append 意图**

- **影响与证据:** 新增的 value-only 订阅调用 `view.replace(ctx, value)`。`packages/chord/src/cell.ts:235-237` 在共享根结构时重新计算 diff，`packages/chord/src/delta/diff.ts:63-68` 会读取旧字符串前缀来判断追加。`generation.ts:367,390-391` 按 256 个 delta 字符或 100 ms 刷新，因此该额外镜像路径随流增长反复扫描前缀。按 512 KiB 流、每次 256 字符发布估算，累计前缀比较量约为 512 MiB；这是代码路径推算，**不是实测耗时或分配结果**。
- **修复:** 从 bridge 传递有序 revision 和已有 envelope ops，在原生 cell 上增量应用；字符串追加使用 `appendText()`，保留 commit/publication 元数据及 root fallback。不能仅以最终 wire op 是 append 作为通过标准。
- **验证要求:** 增加经过 native facet 的流式回归，观察不同长度下的前缀读取或分配增长；`packages/agent/test/harness/pico3/chord.test.ts:339-358` 已给出原生客户端连接路径。
- **验证状态:** `validation_status: confirmed`。`validation_reason`: 独立验证确认发布、镜像和字符串 diff 的可达链路；生产发生率、实际分配和时延影响未测量。

**#2: parent-loss 断言被另一个无效输入条件遮蔽**

- **影响与证据:** `manager.test.ts:165-171` 先明确用 `stdio: "ignore"` 验证缺少 fork IPC slot 的启动会被拒绝，随后 `:173-179` 又用相同三描述符布局声称验证 owner 已关闭。`packages/chord/native/windows-launcher.c:37,80` 的布局检查本身即可阻止应用启动，因此即使 parent-loss 保护失效，该断言仍可能保持绿色。
- **修复:** 保留 malformed-layout 用例；closed-owner 用例改用真实、有效的 fork IPC 描述符布局。增加同布局、live-owner 的成功对照，证明可写入 marker，再断言 closed-owner 返回 125 且不写 marker，并清理子进程和 Job。
- **验证要求:** 在实际 Windows 支持环境执行这组区分性用例。现有 `manager.test.ts:281-314` 是 worker 已启动后杀掉 owner，不能替代启动前 owner 丢失场景。
- **验证状态:** `validation_status: confirmed`。`validation_reason`: 新测试无法隔离其声称验证的前置条件；本轮仅检查测试和 launcher 源码，未执行 Windows 测试，运行时发生率未测量。**此项确认的是测试缺陷，不是已证实的 launcher 逃逸。**

**#3: 延迟计费叶节点劫持 HTML 导出的默认分支导航**

- **影响与证据:** `tool-usage-binding.ts:135-136` 和 `session-manager.ts:1768-1793` 将延迟回执追加到原始 dispatch 祖先，保留当前对话选中叶。导出包含这些条目；`template.js:101-105` 按时间排序子节点，`:170-173` 一直选择最新子节点，`:840-844,1648-1660` 随后只渲染该叶节点的祖先路径。点击早期消息时，较晚到达的纯计费回执会遮住原本更长的对话分支。
- **修复:** 默认寻找对话后代时跳过 usage-only 终端子树；仍保留带真实后续对话的 usage 节点，也允许显式检查回执。可参考 `agent-session.ts:2425-2444` 的 live swipe 处理。
- **验证要求:** 为导出树加入“祖先处追加更晚时间戳回执，另一子分支有完整对话”的用例。`agent-session-codemode.test.ts:1538-1565` 已构造相关数据形状。
- **验证状态:** `validation_status: confirmed`。`validation_reason`: 独立验证确认回执形状可由现有代码产生，导出导航确实会选择它；导出界面实际发生率未测量。

**#4: ModelRuntime 未兑现 Models 请求遥测契约**

- **影响与证据:** `packages/ai/README.md:1137` 明确说明 `Models.stream()`、`streamSimple()` 创建 `pi.ai.request`，`streamDeferred()` 每次 poll 创建 `pi.ai.poll`，而直接 Provider 调用不做该层观测。`model-runtime.ts:732-744,782-815` 直接分派 Provider，并未传入 observer；`packages/ai/src/models.ts:962,984,1012` 的新增 observer 不会被此路径调用。`session-worker.ts:794-798` 和 Harness `runtime/drive/generation.ts:216-220` 证明保留消费者会携带 telemetry 走到这里。
- **修复:** 在 ModelRuntime 的物理 `stream`、`streamSimple` 和 deferred poll 请求边界接入相同 observer；虚拟路由外层不重复观测，避免递归到物理请求时双计数。
- **验证要求:** 经过 ModelRuntime 和保留 Harness 的 recording-telemetry 集成测试应检查 span、首块/首内容事件、token/cost 指标，以及 deferred poll。
- **验证状态:** `validation_status: confirmed`，`protected_subject: public-contract`。`validation_reason`: 文档契约、绕过路径和携带 telemetry 的实际调用方均已由源码建立；运行时发生率未测量。

**#5: 内存 fork 改写了尚有待结算调用的原会话身份**

- **影响与证据:** 付费 classifier/image 调用可以在取消之后才完成；`extensions/codemode/execute.ts:813-826` 仍会记录其 usage。`agent-session-runtime.ts:357-368` 的内存 fork 复用原 `SessionManager` 并改变 session ID，但 recorder 保留 dispatch 时的 ledger identity。`tool-usage-binding.ts:125-131` 无文件可重开，只能取原 manager，随后因 identity 不符抛出 `Tool usage session is no longer available`；替代会话的 flush 又查询新 identity key。
- **修复:** 内存 fork 应从保留条目构建独立 manager，再切换会话身份；原会话的回执接收对象需持续可达，直到其未完成 recorder 调用结算完毕，不能只依赖可能失效的弱引用。
- **验证要求:** 增加内存会话 fork 后 provider 延迟完成的付费回执用例，同时检查原计费归属、替代会话状态和不重复计费。已有持久化 replacement 用例不能覆盖无文件接收对象。
- **验证状态:** `validation_status: confirmed`，`protected_subject: data-loss`。`validation_reason`: 独立验证确认 teardown 的 abort 不排除延迟完成，旧身份与复用 manager 的新身份不匹配会丢失回执；内存 fork 场景的实际发生率未测量。

**#6: Verification gate，不能据此直接修复**

- **候选主张:** 若 A 的 capability acquisition 一直挂起，B 已完成 attach 并发布 `sessionRefs`，随后 A 失败，`client-runtime.ts:250-252` 的共享清理可能释放 B 的引用，使 B 的 getters 抛出 `No Session is attached`。
- **尚缺证据:** 独立验证发现，替换 attachment 时 `packages/client/src/client.ts:200-202` 同步关闭 A 的 session link；`packages/chord/src/host.ts:1492-1495` 将其建立为 downstream link，`connection.ts:1660-1664` 及 `remote.ts:381-393,725-732` 会终止 pending references。现有单次、模拟取消 fixture 未证明上述精确时序能够穿过这些保护。
- **下一步:** 在真实 host 上阻塞 A 的能力获取，完成 B，再令 A 失败，观察 B 的 getters 和已持有引用；或提供等价的调度证明，精确说明关闭 link、pending rejection、发布 B 和清理 A 的先后关系。只有证明真实可达后，才决定是否采用 operation generation、引用归属清理或完整客户端管理串行化。
- **验证状态:** `validation_status: unresolved`，`protected_subject: concurrency`，`autofix_class: advisory`，`owner: human`，`requires_verification: true`，confidence 保持 75。`validation_reason`: 缺少能区分该候选与现有关闭/取消保护的真实重叠复现或等价调度证明，发生率未测量。**不能以未证伪为由确认，也不能以存在保护为由直接驳回。**

**#7: 决策按钮焦点形成刷新死锁**

- **影响与证据:** 在点击后保留按钮焦点的浏览器中，`ui.html:118` 设置 `decisionPending`，初始 disabled render 被 pointer guard 延迟；释放指针后，`:243` 又因 protected focus 拒绝刷新。权威快照在 `:83-90` 同样被延迟，而清除 `decisionPending` 的赋值仅在快照成功安装后发生。`:230` 因此持续忽略后续优先级决策，用户必须先点击保护控件之外的位置才能解开。
- **修复:** 指针激活交接结束后，允许 pending decision 的 disabled render 和最新权威快照完成，不受普通焦点刷新延迟无限阻塞；仍保持原生激活过程和无关后台刷新的焦点保护。
- **验证要求:** 用真实浏览器 pointer/focus 事件覆盖 POST/state 在 pointer-release timer 之前和之后完成的两种顺序。`ui.test.mjs:181-200` 的无焦点模拟点击不能建立该保证。
- **验证状态:** `validation_status: confirmed`，`protected_subject: concurrency`。`validation_reason`: 状态赋值、焦点保护和事件处理链路在代码上形成死锁；原生浏览器中的发生率未测量。

**#8: 指针释放不等于用户已结束文本选择**

- **影响与证据:** `ui.html:161,180` 提供可选中的 summary/body 文本，`:293` 每 8 秒刷新；`:79,83-85,242-250` 只保护指针和控件焦点。非焦点文本的选区未被表示，响应在拖选期间到达会在 pointer release 后刷新，在拖选结束后到达则可直接刷新。`:223` 整体替换 `main.innerHTML`，即使数据未变化，也会删除已选中的文本节点。
- **修复:** 后台替换和 deferred flush 应保护与 `#main` 相交的非折叠原生选区，在 `selectionchange` 确认选区收起或离开后再刷新；或保留未变化的文本 DOM。不能仅靠 pointerup 解除保护。
- **验证要求:** 使用真实浏览器覆盖“响应在拖选期间到达”和“响应在拖选之后到达”，断言文本选区和复制内容保留。
- **验证状态:** `validation_status: confirmed`，`protected_subject: concurrency`。`validation_reason`: 周期刷新、无 selection 保护和删除选中节点的路径已由代码建立；原生浏览器发生率未测量。

### Actionable Findings

以下 7 项均为 `validation_status: confirmed`、`requires_verification: true`。所有 `suggested_fix` 均已保留在运行产物中；执行修复和验证属于调用方，本轮未应用。

| # | File | Issue | Route | Notes |
|---|---|---|---|---|
| 5 | `packages/coding-agent/src/core/tool-usage-binding.ts:130` | 内存 fork 丢失延迟付费回执 | `gated_auto -> downstream-resolver` | P2；先保留原 manager/接收对象生命周期，再验证延迟完成和计费归属 |
| 3 | `packages/coding-agent/src/core/export-html/template.js:171` | 默认导出导航落到纯计费叶节点 | `gated_auto -> downstream-resolver` | P2；修正对话后代选择，保留显式回执检查 |
| 4 | `packages/coding-agent/src/core/model-runtime.ts:789` | 保留 Models 实现缺少请求遥测 | `gated_auto -> downstream-resolver` | P2；在物理请求边界观测，避免虚拟路由双计数 |
| 7 | `scripts/issues/ui.html:243` | 焦点阻止决策完成刷新 | `gated_auto -> downstream-resolver` | P2；先解决 pending decision 与焦点延迟的循环等待 |
| 8 | `scripts/issues/ui.html:250` | 后台刷新销毁原生文本选区 | `gated_auto -> downstream-resolver` | P2；与 #7 联合检查刷新保护，但需要独立 selection 断言 |
| 1 | `packages/agent/src/harness/pico3/chord.ts:347` | 原生流式镜像重复全前缀比较 | `gated_auto -> downstream-resolver` | P2；传递已有 ops，以前缀读取/分配回归检验增量成本 |
| 2 | `packages/chord/test/manager.test.ts:176` | Windows parent-loss 测试不具区分性 | `gated_auto -> downstream-resolver` | P2；有效 IPC 布局加 live-owner 对照，并在 Windows 执行 |

**#6 不在 actionable queue 中。** 它只保留调查和验证任务，不授权直接应用候选修复。

### Deployment Notes

以下是发布证据门，不是额外确认的代码缺陷。本轮未执行迁移、生产查询、备份恢复或 Workers 部署。

- [ ] **确认真实部署边界:** 记录数据库路径或 Durable Object 身份、runtime/package 版本、prefix、JSONL 根目录及实际回滚版本；停止旧 worker、CLI、调度任务和直接 SQL 写入，证明独占所有权。进程内队列不能替代跨进程部署锁。
- [ ] **先备份并实际恢复:** SQLite 使用一致性全库备份或经验证的存储快照，不能在 WAL 活跃时只复制主文件。将备份恢复到独立位置，用实际 rollback binary 打开并保存结果。转换前保存原始 v3 JSONL、权限和哈希，备份需限制访问。
- [ ] **在代表性副本演练:** `packages/durable/src/storage/sqlite/migrations.ts:91-115` 在事务内复制七个 task 列、drop/rename 表并重建五个索引，不是分批 backfill。记录 DB/WAL/temp 空间峰值、锁等待、耗时和失败行为，盘点自定义索引、触发器、视图和外键。`SqliteStorage.open` 会触发迁移，不能把生产 open 当成只读预检。
- [ ] **比较迁移前后数据:** 在静止数据库或一致快照上保存 `PRAGMA integrity_check`、`foreign_key_check`、完整 schema、各表行数、task 状态和全部 task 列。迁移后要求 schema version 为 2，`next_id`/`next_seq` 不变，task 和其他持久化数据双向 `EXCEPT` 差异均为 0，`tasks_v2` 不存在，五个内建索引齐全，自定义对象无意外丢失。所有 SQL 必须使用实际 prefix；改变 prefix 是换命名空间，不是迁移。
- [ ] **验证失败原子性和实际 Workers 行为:** 在副本上分别于 copy、drop、rename、index 阶段注入失败，检查原 schema、数据和 allocator 完整保留且可重试。适用部署还需经过实际 Workers adapter 的 transaction、alarm、eviction/reopen 与完成流程；Node 结果不能替代。
- [ ] **验证 JSONL 首写转换:** 无非空提交时原文件哈希不变；首次非空提交转为 format 4/storage version 1，调用方写入存在，重开后逻辑分支、保留树、配置、摘要/system checkpoint 和 usage 总量正确。ID 会重建，应比较逻辑关系而非旧短 ID。覆盖祖先/null leaf、独立回执、重放计费和折叠 `systemMessage`；发布失败应保留原字节和可见状态并可重试。
- [ ] **明确回滚限制:** schema-1-only binary 会拒绝已提交的 schema 2，不能只回滚代码、手改版本号或换 prefix。需使用 schema-2-capable 回滚版本，或停写后恢复一致快照；同时核对快照后的 submissions、工具外部副作用和 provider 费用。旧 v3 writer 也不能被假定能写已转换的 JSONL。
- [ ] **恢复流量后监控:** 首 5 分钟及 +1h、+4h、+24h 检查迁移/open 错误、`SQLITE_BUSY`、磁盘满、rollback/unsupported-schema、JSONL parse/publication 错误；检查 `session_failed`、`migration_failed`、`task_outdated`、`task_parked`。抽查 sleeping task 从 checkpoint 恢复而非重做外部动作，以及历史选择和 usage 恰好计入一次。

只有拿到备份恢复、精确数据比较、资源测量、独占所有权及适用 Workers/JSONL 恢复证据后，才可解除相应发布门。完整操作依据保存在本轮 `deployment-verification-agent.md`。

### Coverage

**范围与语义覆盖**

| Correctness 分区 | 已作语义检查的路径 | 证据不足的路径 |
|---|---:|---:|
| correctness-models | 117 | 150 |
| correctness-native | 77 | 93 |
| correctness-history | 22 | 88 |
| correctness-execution | 43 | 259 |
| correctness-surface | 110 | 313 |
| 合计 | 369 | 903 |

- 1,272 个路径均已编目且归属一次；**全范围编目不等于逐 hunk 审查通过**。369 个路径表示对变更行为作了有意义的语义检查，不表示每个文件或 hunk 完整放行；903 个路径没有足够证据支持该声明。这是 **partial semantic review**，不能据此宣称无其他缺陷。
- 图索引停留在 `2026-10-09T02:02:57Z`，未启用 watch，且存在 native、新路径及排除项缺口。本轮使用当前源码和文本消费者搜索补充，不据旧图作无调用方或完整覆盖的结论。
- 历史报告正文未作为发现种子。maintainability 搜索曾偶然暴露历史 ledger，审查者声明未保留其中发现或结论；correctness 分区 patch 已排除历史报告正文。
- 四个 Windows 二进制路径已归属 native，但其行数不可统计，**二进制与源码等价性、真实加载、描述符交接和 Job-tree 行为均未验证**:
  - `packages/chord/native/prebuilds/win32-arm64/windows-job.node`
  - `packages/chord/native/prebuilds/win32-arm64/windows-launcher.exe`
  - `packages/chord/native/prebuilds/win32-x64/windows-job.node`
  - `packages/chord/native/prebuilds/win32-x64/windows-launcher.exe`

**跨模型、审查者与验证**

- adversarial lens: in-process fallback (cross-model peer not run: OAuth session expired and could not be refreshed)
- 外部目标为 Claude，请求配置是 `claude-opus-5-5/high`，但没有可用 receipt；实际模型和 effort 未验证，`independence_verified:false`。未折入外部 artifact，未使用跨模型独立性提升 confidence。已知可认证的不同目标仅 Claude，没有可用替代接收方。
- 15 个本地审查视角及必需的 adversarial fallback 均在每位 20 分钟界限内完成；最多同时 5 位。部分研究超过 8 分钟目标，但没有失败或超时审查者。配置的 midtier 不可用，相关审查者按已记录的 parent-inherit 路由运行，不能声称使用了不可用模型。
- 8 个候选按稳定编号全部进入同一 validator batch，未因正常 cap 遗漏。结果为 **confirmed 7、rejected 0、unresolved 1、malformed 0、failed 0、shortcut-skipped 0、cap omissions 0**。没有独立跨模型佐证可授权跳过验证。
- 独立保护分类为 #4 `public-contract`、#5 `data-loss`、#6/#7/#8 `concurrency`；#1/#2/#3 不属于八类保护主题。没有移除 validator 给予的保护，也没有 protected rejection 需要重分类。
- #6 的 unresolved 原因是精确重叠时序是否能穿过真实 link/reference 关闭保护尚未建立，不是基础设施失败、超时、驳回或确认。它保留原 P2/75，并改为 report-only verification gate。
- 7 个 confirmed 均基于源码、调用方和相关 fixture 检查；**没有执行复现，也没有测量生产发生率**。#1 未测量真实性能；#2 未运行 Windows；#7/#8 未运行原生浏览器。确认代码允许的缺陷，不代表已观测到生产事件。

**合成和规则处理**

- 读取了 14 份结构化审查 artifact/return 及 2 份非结构化 advisory artifact，8 项均完成 detail hydration。
- `first_evidence` 回填 8 项；malformed return/finding 均为 0；精确及语义重复删除均为 0；pre-existing finding 为 0。
- confidence suppression 为 0，各 anchor 无压低条目；mode-aware demotion 为 0。没有 repository review policy 导致的删除或改级，也没有纳入受保护文档清理建议。
- 未发现 CE config/packs/solutions 或指定的独立标准来源；沿用既定标准路由，活动全局/root AGENTS 仍具约束力。
- agent-native 定向能力检查未保留可行动缺口；该结论仅适用于已追踪的工具发现、codemode、MCP、SDK 和程序化服务路径，不是全部 UI/RPC 或删除导出消费者的完整保证。

**仍需验证的风险与测试空缺**

- SQLite schema 2 和 JSONL 首写转换的回滚、恢复后写入及外部副作用对账未演练；legacy JSONL 多遍读取所需独占所有权、崩溃/断电行为、生产规模锁/磁盘成本和真实 Workers 迁移仍未验证，不据此新增迁移缺陷。
- `packages/durable/test/sqlite-migrations.test.ts:115-175` 的失败测试是在已达到 schema 2 后添加迁移，不能替代 v1->v2 task 重建各阶段的失败注入。需检查失败后 version 仍为 1、七列数据和 allocator 不变、原索引保留、无 `tasks_v2`，且重试成功。
- Cloudflare image 入口缺少实际 workerd/Wrangler 初始化覆盖。Node `WebAssembly.compile` 和直接调用 `createPhotonImages` 不等价于经 `CompiledWasm` 规则导入 `createCloudflarePhotonImages`；应在目标 host 上准备真实小图。
- 原生浏览器 Tab/focus 顺序和 Space keydown/keyup 与延迟刷新组合未执行，区别于 #7/#8 已选定缺陷。
- Windows 支持 Node 版本的 addon/Job 生命周期、macOS/BSD 和 Linux/Android 锁与进程组清理、分布式 reload rollback/shutdown、路由 attachment 转换及真实终端模式恢复均未执行。这些是验证边界，不是新增运行时缺陷。

**运行产物**

运行目录: `/tmp/compound-engineering-501/ce-code-review/20261104-034547-r3-e61b4049`

- `final-findings.json`: 最终 8 项及逐项验证原因、#6 门控路由。
- `actionable-findings.json`: 7 项可行动修复，明确排除 #6。
- `advisory-outputs.json`: 风险、测试空缺和部署建议。
- `validator-verdicts.json`、`validator-outcome.json`: 完整独立验证结果。
- `metadata.json`、`stages.jsonl`: 本轮元数据和阶段成本，summarize 返回 `status: complete`；这表示日志阶段完整，**不是代码验证或覆盖完整**。
- `report.md` 由调用方持久化；向 `docs/plans/2026-10-30-c08a2fb-image-billing-code-review.md` 保留历史并追加本报告也由调用方负责。本报告 leaf 未写入上述两个 Markdown 目标。

---

### Verdict

> **Not ready**
>
> **原因:** 当前审查 HEAD `1da23c158f319ac39829ef13c7da557183e0637a` 仍有 7 个已确认、尚未修复的 P2；另有 #6 concurrency 验证门未解除。#6 不能直接修复，也不能从结论中消失，需要真实 host 重叠复现或等价调度证明。全部候选均已验证处理，但本轮不是零新增；部分语义覆盖、未验证 Windows 二进制和发布证据门也不支持完整放行声明。
>
> **下一步:** 调用方修复并验证 7 个 confirmed，同时独立调查 #6；修复后继续以固定第一父 base 审查 merge 及全部修复，不能把报告完成或 actionable 不含 #6 当成收敛。
>
> **建议修复顺序:** #5 -> #3 -> #4 -> #7 -> #8 -> #1 -> #2。#6 是并行取证任务，不是 apply 项。

**Actionable Findings recap**

以下均为 P2、`autofix_class:gated_auto`、`suggested_fix:present`、confidence 75、owner `downstream-resolver`，均需修复后验证:

1. **#5** `packages/coding-agent/src/core/tool-usage-binding.ts:130` - 保留内存 fork 原会话的延迟计费接收对象，避免付费回执丢失。响应类型: 代码修复与计费回归。
2. **#3** `packages/coding-agent/src/core/export-html/template.js:171` - 默认导航排除纯计费终端分支，保持对话尾部可见。响应类型: 导航修复与导出树回归。
3. **#4** `packages/coding-agent/src/core/model-runtime.ts:789` - 为物理请求接入 Models 遥测，不重复观测虚拟路由。响应类型: 契约修复与 recording-telemetry 集成验证。
4. **#7** `scripts/issues/ui.html:243` - 解除按钮焦点与 pending decision 刷新的循环等待。响应类型: 状态机修复与真实浏览器时序验证。
5. **#8** `scripts/issues/ui.html:250` - 后台刷新保护原生文本选区或保留稳定 DOM。响应类型: 交互修复与 selection 回归。
6. **#1** `packages/agent/src/harness/pico3/chord.ts:347` - 原生镜像保留 append ops，消除反复全前缀比较。响应类型: 增量路径修复与成本回归。
7. **#2** `packages/chord/test/manager.test.ts:176` - 使用有效 fork IPC 布局和 live-owner 对照，使 parent-loss 测试有区分性。响应类型: 测试修复与 Windows 执行。

可行动产物: `/tmp/compound-engineering-501/ce-code-review/20261104-034547-r3-e61b4049/actionable-findings.json`。**#6 仍为 unresolved verification gate，不在以上修复队列中。**


## Round 3 repair disposition and protected-gate resolution

The seven confirmed findings have implementation changes and the focused proof below. Windows launcher execution remains unavailable on this host; #2 is a repaired test-design defect, not a claim of an observed native runtime escape. The initial report above remains an immutable snapshot of the reviewed HEAD and its then-unresolved #6 gate.

| Finding | Disposition | Observed proof |
|---|---|---|
| #1 native Pico mirror | Bridge publishes named ordered `ChordViewRevision` frames; native state applies known ops, preserving `appendText` intent and metadata/root fallback. Generic facet/service types accept configured harnesses. | Original source in an isolated scratch copy failed both refined regressions: native 24 reads versus source baseline 8; 414,720 versus 138,240 prefix characters at 16 KiB, and 1,594,368 versus 531,456 at 64 KiB. Fixed native matches the same source-only baseline exactly: zero added scans. Chord/raw-frame files: 21 passed. The original source `ViewManager` baseline work was not changed or relabeled a mirror defect. |
| #2 Windows parent-loss test | Keep invalid-layout case; add a dedicated marker IPC fixture, separate live/closed jobs, production-equivalent fork descriptors, a real live `launched` handshake, marker/IPC success control and closed-owner exit 125. Message assertions execute after exit, not in event callbacks. | Manager file: 25 passed / 10 platform-skipped. Standalone marker fixture executed on Darwin: marker written, IPC acknowledged, exit 0. **Actual Windows launcher/Job execution and binary-source equivalence remain unverified; no Windows red/green claimed.** `createWindowsJob.close()` is already idempotent; explicit close after child exit does not re-terminate an empty Job. |
| #3 exported receipt navigation | Iterative subtree eligibility ignores usage-only terminal branches for automatic continuation, retaining state/policy tails, continuation through usage, explicit receipt inspection and deep-tree safety. | Four new export cases failed before repair by selecting `latest-receipt`; complete export file passes. Actual generated 290,366-byte HTML opened in Chromium; clicking the question tree node retained the later conversation, with the late receipt still represented. |
| #4 retained Models telemetry | Reuse the exported `observeModelRequest` observer at physical stream/simple/poll lazy boundaries; virtual routing wrapper remains unobserved. Root/models export and telemetry docs updated. | Auth-options suite red: 15 failed / 11 passed; green: 26 passed. Assertions cover spans/parentage, events, usage/cost, no-consumption results, authentication, cancellation, provisional polls and exactly-once routed physical telemetry. One new auth-error fixture was corrected to the existing normalized error suffix; span assertions were unchanged. |
| #5 in-memory fork receipts | Fork a separate deep-cloned manager; retain outgoing identity/selection. Dispatched recorders hold only the in-memory data destination strongly; reusable factories and persisted managers stay weak. Pending failed receipts retain their destination until publication. Historic fork billing semantics remain unchanged. | Runtime red: five failures; GC red: collected destination. Complete runtime/codemode/export files: 86 passed, including delayed classifier/image completion, before/at fork, original attribution, no late-charge inheritance, exactly once and real GC retention. Standalone source-runtime sink smoke observed original identity/parent preserved, one original receipt, zero fork receipts after owner release. |
| #7 pointer decision focus | After pointer/click handoff, pending decisions flush their disabled render and authoritative snapshot without the ordinary background-focus deferral deadlocking them. | UI red: 48 passed / 24 failed; green: 72 passed, including 12 pointer/focus/order cases. Real native priority click before repair left focused controls enabled and ignored a second decision; clean repaired scenario disabled pending controls, installed issue 20 and accepted the next issue-20 decision without outside blur. |
| #8 native selection | Background snapshots/renders protect noncollapsed ranges intersecting main, including cross-boundary ranges; `selectionchange` retries after collapse/outside movement. Explicit decision updates retain precedence. | Twelve selection regression cases failed before repair and pass afterward. Actual Chromium with the unchanged 8-second poll: before repair selected `this issue summary` became empty and its node detached; clean repaired atomic scenario retained text/node/issue 10, then installed issue 99 after collapse. Selection was established through the native Range API, not a physical drag; drag/order permutations are unit coverage. |

### #6 protected concurrency gate: rejected by discriminating real-host evidence

No production change was applied for #6. Three real-Host/memory-link tests separately gate A's Models, AgentController and Transcript readiness, supersede A with B, then release/cancel A and positively exercise B's methods and generation-2 state. All three passed with the asserted schedule **A rejected -> B models activated -> B published**. At reviewed revision `1da23c158`, Node 24.15.0 on Darwin arm64, synchronous old-link closure rejects A's pending bindings before B can publish; the proposed B-published-then-A-cleanup interleaving is refuted for this exact candidate. `attachment-resolution.json` records the runtime/configuration, trigger, assertions and source guard trace. This does not claim all conceivable client-management interleavings are safe; it resolves the specific initially unresolved finding without treating lack of disproof as confirmation.

### Integration evidence and limits

Nine complete coding-agent repair/adjacent files passed **237 tests**. The complete native Pico/raw-frame files passed **21 tests**; issue UI **72 tests**; manager **25 passed / 10 skipped**. Offline build completed with exit 0, producing the 76-file, 9.4-MiB coding-agent bundle. `npm run check` completed with exit 0, 1,986 files and **No fixes applied**, including TypeScript and browser-smoke. The first formatter pass touched seven owned source/test paths and a later marker assertion was formatted; the observed dirty set remains the declared 19 tracked repair/report/docs paths plus the new marker fixture, without manifest/lockfile or unrelated changes.

The first authoritative isolated suite ended **13,741 passed / 1 failed / 945 skipped**, exit 1. The only failure was the pre-existing mobile-handoff delta wall-clock complexity ratio (287.5 versus threshold 40). A temporary behavioral replacement was fully reverted; its passing result is not acceptance evidence. The original unchanged file then passed all 60 cases sequentially. Its original threshold and code remain intact and it is excluded from this commit. The failed suite receipt is retained as `initial-suite.log` / `initial-suite-exit.json`; the authoritative rerun with the original unchanged test completed: **13,742 passed / 0 failed / 945 skipped**, exit 0, 366.31 seconds (`suite.log`, `suite-exit.json`, `artifact://522`). A final sequential `npm run check` after suite completion also exited 0 with No fixes applied (35.79 seconds).

Runtime artifacts: `pico-prefix-proof.json`, `attachment-resolution.json`, `browser-smoke.json`, `export-browser-smoke.json`, `memory-receipt-smoke.json`, `timing-guard-disposition.json`, `build-exit.json`, `check-exit.json`. Browser timeouts/mixed-control attempts were discarded and clean scenarios rerun; no failed attempt is represented as passing evidence. Browser tabs/services and temporary smoke/scratch sources were closed/removed. Rust/native binaries were unchanged this round and not newly verified. Existing deployment/Workers/Windows operational gates remain.

The exact decoded Round 3 report was appended before repair, preserving the original 58,536-byte prefix (SHA-256 `1ee18fefc26d4c5e2d6f285ea5d0a9edf7a442a761d3603d73c8bdfd648a5746`). After this round is committed, a fresh full-range review is still required; this is not a zero-finding round.

