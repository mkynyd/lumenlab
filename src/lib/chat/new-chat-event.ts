/**
 * 「新对话」命令事件。
 *
 * 背景：发送首条消息后用 `history.replaceState` 把 URL 改成 /chat/<id>，
 * 但不经过 Next 路由（避免流式中途重挂载）。此时侧边栏「+」router.push("/chat")
 * 与路由内部状态相同，是一次 no-op，页面仍停留在旧对话状态。
 * 侧边栏在跳转前派发该事件，ChatArea 订阅后主动重置会话状态，两条路径
 * （真实导航重挂载 / 同路由原地重置）都能回到全新对话。
 */

const NEW_CHAT_EVENT = "lumenlab:new-chat";

export function emitNewChat() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NEW_CHAT_EVENT));
}

export function onNewChat(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(NEW_CHAT_EVENT, handler);
  return () => window.removeEventListener(NEW_CHAT_EVENT, handler);
}
