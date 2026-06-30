# Product

## Register

product

## Users

面向中学生、中学教师、大学各专业学生、考研学生与通用学习者。用户通常在桌面端持续使用聊天、项目资料和成果库，希望快速切换上下文并保持工作区专注。发布渠道为微信朋友圈 A 测。

## Product Purpose

LumenLab 是一个通用 AI 工作台。用户可以建立项目、上传和解析资料、选择上下文进行对话，并把有价值的回答保存为可导出的成果。通过可选的身份分类系统，为不同背景的用户（中学生、医学生、工科生、文科生、教师、考研学生等）自动匹配任务模式和提示词，降低使用门槛。

## Brand Personality

克制、可靠、专注。界面应像成熟的生产力工具，信息结构清晰，交互反馈直接，不用装饰干扰任务。

## Anti-references

避免重复侧边栏、层层嵌套卡片、装饰性动画、玻璃拟态、过度圆角和高饱和色块。避免让导航占据内容注意力，或让用户在聊天与项目之间失去当前位置。

## Design Principles

1. 一个稳定的应用壳层承载聊天与项目导航。
2. 进入具体项目后优先让出空间给项目任务和对话。
3. 主要操作始终可见，次要信息按需展开。
4. 动效只用于解释状态变化，并尊重减少动态效果偏好。
5. 所有图标按钮都提供可见边界、焦点状态和明确标签。

## Workbench Skill Iconography

Skill 菜单与 Skill 触发按钮统一使用 Iconoir 图标，不在生产 UI 中使用 emoji。图标选型可参考 [Iconoir](https://iconoir.com/)，但代码必须通过本地 npm 包 `iconoir-react` 静态导入，禁止通过 CDN、远程 SVG、远程 CSS 或运行时访问图标网站插入图标。Bootstrap Icons 仅作为 Iconoir 没有可用隐喻时的备用来源，且同样必须本地安装后静态导入；当前 Skill 菜单不需要备用图标。

| Skill / Action | Iconoir icon | 用途说明 |
|---|---|---|
| Skill trigger | `Brain` | 表示 Agent/Skill 能力入口 |
| 自动 Skill | `MagicWand` | 表示自动识别与推荐 |
| 论文阅读 | `OpenBook` | 表示阅读论文与资料 |
| 论文写作 | `EditPencil` | 表示写作与编辑 |
| 抓考试重点 | `Gps` | 表示定位重点与范围 |
| 复习教练 | `GraduationCap` | 表示考试复习与学习辅导 |
| 代码阅读 | `CodeBrackets` | 表示代码理解 |
| 苏格拉底导师 | `ChatBubbleQuestion` | 表示追问与引导式对话 |
| 关闭 Skill | `Xmark` | 表示停用当前 Skill |

## Landing Page Exception

应用内部（聊天、项目、工具、设置）严格遵循克制动效原则。Landing 页作为品牌第一印象与功能预览场景，允许使用装饰性滚动揭示、文字轮播等氛围动效，但仍需响应 `prefers-reduced-motion` 并在核心交互区域保持清晰可点击。

## Accessibility & Inclusion

以 WCAG AA 为基础，保证键盘导航、可见焦点、足够的颜色对比和语义化标签。侧边栏动效支持 `prefers-reduced-motion`，图标按钮使用可读的 `aria-label` 与状态属性。
