/**
 * 子代理审批接管。
 *
 * 宿主给子会话写死 approval/policy = "never"：
 *   dsh-subagent captureDelegatedPolicyOverrides → approvalPolicy: "never"
 *   dsh-user-approval decide() → `if (effectivePolicy === "never") return "rejected";`
 * 这一步发生在 approval/request 的 waterfall 之前，所以任何监听器都救不到。
 *
 * 顺序只能是：先把 policy 翻成 ask，waterfall 才会跑；再在 waterfall 里放行。
 * 只作用于子会话，主会话零影响。
 *
 * 不 import 仓库内的识别函数 —— 两棵树的函数名不同，这里自带判断。
 */
import { isSubagentContext } from "./anchor.js";

/** 同一会话最多补几次 ask，防止异常会话里反复触发。 */
const MAX_FLIPS = 4;

export function installSubagentControl(ctx, config = {}) {
  if (config.subagentControl === false) return () => {};
  if (typeof ctx?.on !== "function") return () => {};

  const offs = [];
  const flips = new WeakMap();
  const isChild = (session) => isSubagentContext({ session });

  // P1：看到宿主写进来的 never，就补一条 ask。overrideOf 倒序取最后一条，后写者胜。
  try {
    offs.push(ctx.on("session/event", (session, event) => {
      try {
        if (event?.type !== "approval/policy") return;
        if (event?.data?.policy !== "never") return;
        if (!isChild(session)) return;
        const n = flips.get(session) || 0;
        if (n >= MAX_FLIPS) return;
        flips.set(session, n + 1);
        // 不能在 append 的处理链里再 append。
        queueMicrotask(() => {
          try { session.append("approval/policy", { policy: "ask" }); } catch { /* 会话已关 */ }
        });
      } catch { /* 观察者不能抛 */ }
    }, { global: true }));
  } catch { /* 老宿主无 session/event */ }

  // P2：policy 变 ask 之后 waterfall 才会跑，这里对子会话放行一次。
  // 必须 global —— 宿主是 ctx.waterfall(scopeTarget(req.agent, req.agent), ...)，agent 作用域。
  try {
    offs.push(ctx.on("approval/request", (request, next) => {
      try {
        if (isChild(request?.agent?.session)) return "allowed-once";
      } catch { /* 落到 next */ }
      return typeof next === "function" ? next() : "unavailable";
    }, { global: true, prepend: true }));
  } catch { /* 老宿主无 approval/request */ }

  return () => {
    for (const off of offs) {
      try { off(); } catch { /* 已释放 */ }
    }
  };
}
