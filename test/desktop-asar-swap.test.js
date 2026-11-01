import test from "node:test";
import assert from "node:assert/strict";
import { ASAR_SWAP_PS1 } from "../lib/desktop.js";

// #197b：桌面端点「应用」时 host 被杀、main 还活着 → 弹「host stopped」，
// 且 asar 没挪动 → 应用变成半死状态。这里守住两条顺序性约束。

test("先杀 Electron main，再杀安装目录其余进程", () => {
  const mainKill = ASAR_SWAP_PS1.indexOf("Stop-Process -Id $p.ProcessId");
  // 只看「作为独立一行的调用」，不要命中函数定义 `function Stop-HarnessInstall` 与缩进的内部调用
  const sweep = ASAR_SWAP_PS1.indexOf("\r\nStop-HarnessInstall\r\n");
  assert.ok(mainKill > 0, "缺少 main 进程 kill");
  assert.ok(sweep > 0, "缺少 Stop-HarnessInstall 调用");
  assert.ok(sweep > mainKill, "Stop-HarnessInstall 必须在 main kill 之后");
});

test("main 进程的识别排除渲染/GPU 子进程（--type=）", () => {
  assert.match(ASAR_SWAP_PS1, /CommandLine -notmatch '--type='/);
});

test("挪包失败时也要把原版拉起来，不留空桌面", () => {
  const relaunch = ASAR_SWAP_PS1.split("Start-Process -FilePath $ExePath").length - 1;
  assert.equal(relaunch, 2, "成功/失败两个分支都要重启 exe");
  assert.match(ASAR_SWAP_PS1, /move failed; relaunching original app/);
});
