/**
 * verify-gate：宣称修好但没验证的收尾门
 *
 * 规则来自本机 277 个会话的实测（progress/动作层检测：宣称修好但没验证.md）：
 *   收尾文本命中成功宣称，且这一轮（用户消息到下一条用户消息）里
 *   要么没跑过任何测试命令，要么有工具报错 —— 这类收尾后来被返工 29.3%，
 *   基线 20.4%（Fisher p=0.0093）。分格看更狠：有报错 36.2%、没测试 32.9%，
 *   而跑过测试再宣称的只有 3.8%。
 *
 * 设计要点：提示只给用户看，不给模型看。
 *   早期版本把提示插进会话（模型看得见），结果触发续跑、续跑又命中、又插提示，
 *   用户想收工都收不了。现在命中后弹一个选择框（模型看不见），用户自己决定
 *   收工还是去验证，收工就静默放过，不会再触发，也不会打断。
 *
 * 用法：自动生效；/verifygate off 关，/verifygate on 开，/verifygate 看状态。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 成功宣称（与实验用的正则一致）
const CLAIM =
	/已修复|修复完成|已解决|搞定|完成(了|好)|修好了|works now|now works|\bfixed\b|\bresolved\b|验证通过|已验证|工作正常|恢复正常|问题(已|都)(解决|修复)/i;

// 测试类命令（与实验用的正则一致）
const TEST =
	/\b(pytest|pnpm test|npm test|yarn test|go test|dotnet test|cargo test|vitest|jest|make test|python -m pytest|unittest|ctest|tox)\b/i;

let hadTest = false;
let hadError = false;
let errorTools = new Set<string>();
let enabled = true;
let hits = 0;
let askedThisTurn = false;
let wrappedThisTurn = false;

function reset() {
	hadTest = false;
	hadError = false;
	errorTools = new Set();
	askedThisTurn = false;
	wrappedThisTurn = false;
}

export default function (pi: ExtensionAPI) {
	// 一轮 = 一次用户提问到下一条用户消息，开始时清账。
	// 插件自己让模型去验证引发的续跑不算新的一轮。
	pi.on("before_agent_start", async (event) => {
		const prompt = typeof event.prompt === "string" ? event.prompt : "";
		if (prompt.includes("[verify-gate]")) return;
		reset();
	});

	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash" && event.toolName !== "powershell") return;
		const cmd = String((event.input as { command?: unknown })?.command ?? "");
		if (cmd && TEST.test(cmd)) hadTest = true;
	});

	pi.on("tool_result", async (event) => {
		if (event.isError) {
			hadError = true;
			errorTools.add(event.toolName);
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (!enabled) return;
		if (wrappedThisTurn) return;
		const msg = event.message as unknown as { role?: string; content?: unknown };
		if (msg.role !== "assistant") return;
		const blocks = Array.isArray(msg.content) ? (msg.content as any[]) : [];
		let text = "";
		let hasToolCall = false;
		for (const b of blocks) {
			if (!b || typeof b !== "object") continue;
			if (b.type === "text" && typeof b.text === "string") text += b.text;
			else if (b.type === "toolCall") hasToolCall = true;
		}
		// 还带着工具调用的不是收尾消息
		if (hasToolCall) return;
		if (!text.trim() || !CLAIM.test(text)) return;
		// 跑过测试且没报错：放行
		if (hadTest && !hadError) return;
		// 同一轮只问一次
		if (askedThisTurn) return;

		const why = !hadTest
			? "这一轮没跑过任何测试"
			: `这一轮有工具报错（${[...errorTools].join("、")}）`;
		askedThisTurn = true;
		hits += 1;

		const title = `模型说搞定了，但${why}`;
		const detail = "实测这类收尾 29.3% 会被返工（基线 20.4%）";

		// 有界面就弹选择框，模型看不见，不会形成循环；无界面（print/headless）只记一笔
		if (ctx.hasUI && (ctx.mode === "tui" || ctx.mode === "rpc")) {
			let choice: string | undefined;
			try {
				choice = await ctx.ui.select(title, ["收工，就这样", "先去验证"], {
					allowFreeform: false,
				});
			} catch {
				ctx.ui.notify(`${title}（${detail}）`, "warning");
				return;
			}
			if (choice === "先去验证") {
				pi.sendMessage({
					customType: "verify-gate",
					content: `[verify-gate] 用户要求先验证再收工：${why}。请补一次验证（跑测试或复核结果），然后再给结论。`,
					display: true,
					details: { reason: !hadTest ? "no-test" : "tool-error", askedBy: "user", hits },
				});
			} else {
				// 收工：静默放过，这一轮不再打扰
				wrappedThisTurn = true;
				ctx.ui.notify(`verify-gate：已收工（${detail}）`, "info");
			}
			return;
		}

		ctx.ui.notify(`${title}（${detail}）`, "warning");
	});

	pi.registerCommand("verifygate", {
		description: "verify-gate 状态：on / off / 默认显示状态",
		handler: async (args, ctx) => {
			const a = (args || "").trim().toLowerCase();
			if (a === "off") enabled = false;
			else if (a === "on") enabled = true;
			ctx.ui.notify(
				`verify-gate ${enabled ? "开" : "关"}，本次会话已命中 ${hits} 次`,
				enabled ? "info" : "warning",
			);
		},
	});
}
