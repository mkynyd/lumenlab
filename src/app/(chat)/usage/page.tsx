import { redirect } from "next/navigation";

// 用量页已并入设置面板的「用量统计」标签，保留此路由作为深链入口。
export default function UsagePage() {
  redirect("/chat#settings-usage");
}
