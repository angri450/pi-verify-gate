# pi-verify-gate

模型说"修好了/搞定了"，但这一轮没跑过测试，或者这一轮自己的命令报过错——插件这时候问用户一句：收工，还是先去验证？

**提示只给用户看，模型看不见。** 这一条是刻意的：早期版本把提示插进会话（模型看得见），模型看到后自己又复述一遍"修好了"，插件再报一次，又触发续跑——用户想收工都收不了。现在命中后弹一个选择框，用户选"收工"就静默放过，本轮不再打扰，也不会有续跑。

## 规则从哪来

本机 277 个 pi 会话、1,724 个带收尾文本的轮次，返工标签 = 该轮次改过的文件后来又被改了一次（只看会话自己的行为，不依赖用户说话）：

| 情况 | n | 后来被返工 |
|:--|--:|--:|
| 宣称修好 + 这轮有工具报错 | 105 | 36.2% |
| 宣称修好 + 没跑测试 | 146 | 32.9% |
| 宣称修好 + 跑过测试 | 26 | 3.8% |
| 不宣称（普通收尾） | 1,547 | 20.4% |

插件命中条件 `宣称 && (没测试 || 报错)` 合计命中 167 次，返工率 29.3%，未命中 20.4%，Fisher p=0.0093。对照组说明问题不在"宣称"本身，在缺验证。

这套词表和正则不依赖模型内部数据（拿不到 logprob），也不用第二个模型当裁判，纯文本 + 工具结果。

## 怎么判的

- 一轮 = 一次用户提问到下一条用户提问，`before_agent_start` 时清账
- `tool_call` 里出现 `pytest|pnpm test|npm test|yarn test|go test|dotnet test|cargo test|vitest|jest|make test|python -m pytest|unittest|ctest|tox` 算跑过测试
- `tool_result` 的 `isError` 记下本轮有报错（并记工具名）
- `message_end` 里取没有 `toolCall` 的助手消息（真正的收尾），文本命中 `已修复|搞定|修好了|fixed|resolved|验证通过|工作正常|恢复(正常)?` 等成功宣称
- 跑过测试且没报错 → 放行；同一轮只问一次；用户选"收工"后本轮静默

## 装法

个人扩展（每个会话自动加载）：

```bash
mkdir -p ~/.pi/agent/extensions/verify-gate
cp extensions/verify-gate.ts ~/.pi/agent/extensions/verify-gate/index.ts
```

或作为 pi 包安装：

```bash
pi install git:github.com/angri450/pi-verify-gate
```

## 用法

自动生效。命中时 TUI 弹选择框：`收工，就这样` / `先去验证`。选"先去验证"才会给模型插一条验证要求；选"收工"只通知用户，会话不动。无界面环境（`--print`、headless）只写一条通知，不插会话。

命令：

- `/verifygate` — 看状态（开/关、本次会话命中几次）
- `/verifygate off` / `/verifygate on` — 关/开

## 局限

- 精确率 29.3%，命中里七成其实没出事，所以是提醒不是拦截
- 测试命令只认正则，codemode 和 subagent 里跑的测试看不到，会被误判成"没跑测试"
- "跑过测试"按命令名判断，跑一次空套件也算
- 宣称正则偏保守，只认结果性断言，不认"应该没事了""基本上通了"

## 相关

- `docs/动作层检测-宣称修好但没验证.md` — 实验报告全文
- `data/action-layer-result.json`、`data/verify-gate-union.json` — 实测数字
- 同批实验还跑过两条线，结论都是关掉：文本犹豫词表（系数为负，犹豫越多坏事越少，见 `knowledge/犹豫词表-实测.md`）、论文的 MRF 平滑（邻居不相似，平滑无从下手）

## License

MIT
