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
