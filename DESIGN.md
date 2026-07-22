# Design

## Motion

应用内部动效遵循克制动效原则：只用于解释状态变化，尊重 `prefers-reduced-motion`。

## Landing Page Exception

Landing 页是品牌第一印象与功能预览场景，允许使用装饰性滚动揭示、文字轮播与低对比环境渐变等氛围动效，但仍需响应 `prefers-reduced-motion`，并保证核心 CTA 与导航清晰可点击。环境渐变只能在 landing 使用，采用 transform/opacity 的非线性缓动，不得延迟首屏内容或用于文字填充。
