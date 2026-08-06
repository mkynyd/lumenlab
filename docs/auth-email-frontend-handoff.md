# HANDOFF：认证改造前端实施（P4）— 邮箱验证注册 Stepper / 忘记密码 / 密码重设页

> 交接日期：2026-08-06
> 交接方：主业务后端（P0–P3、P5–P6 已完成并全量测试通过）
> 接收方：kimi（前端实施）

## 交接目标

完成认证改造的**前端部分**（P4），让以下流程可端到端使用：

1. 注册：多步 Stepper「邮箱 → 验证 → 设置密码 → 完成」
2. 验证码 + 邮件链接双通道验证
3. 登录页「忘记密码？」入口
4. `/forgot-password`（提交邮箱）与 `/reset-password`（设置新密码）页面

后端 API 与领域逻辑**已全部完成**（1314 个测试全绿，`npm run build` 通过），本轮只做前端。

## 必须遵守

- 先读 `AGENTS.md` 与 `REPOSITORY_INDEX.md`
- Next.js 16 代码修改前读 `node_modules/next/dist/docs/` 对应章节（`01-app/01-getting-started/15-route-handlers.md`、`01-app/02-guides/environment-variables.md`）
- 所有代码直接在 `main` 分支
- 完成后：`npm run lint` → `npx tsc --noEmit` → `npm test` → `npm run build` 全绿
- 更新 `REPOSITORY_INDEX.md`（gitignored，禁止 git add）
- 提交格式：`feat: ...`（英文简短描述）

## 后端已完成的接口契约（前端直接调用，勿改）

### 注册验证

| 方法/路径 | 请求体 | 成功响应 | 错误 |
|---|---|---|---|
| POST `/api/auth/verify/send` | `{email}` | 200 `{success:true, resendAfter:60}` | 409 `{error:{email:["该邮箱已被注册"]}}`；429 `{error:"请求太频繁，请稍后再试"}`；500 发送失败 |
| POST `/api/auth/verify/code` | `{email, code}` | 200 `{success:true, ticket}` | 400 `{error:{code:["请先获取验证码"\|"该邮箱已完成验证"\|"验证码已过期，请重新获取"\|"验证码错误"\|"尝试次数过多，请重新获取验证码"]}}`；429 |
| GET `/api/auth/verify/link?token=` | — | 302 → `/register?verified=1&ticket=<t>&email=<e>` | 302 → `/register?verify=failed` |
| POST `/api/auth/register` | `{email, password, ticket}` | 201 `{success:true, user:{id,email,name}}` | 409 `{error:{email:["该邮箱已被注册"]}}`；400 `{error:{email:[未验证]}}` 或 `{error:{ticket:[验证已失效/已过期，请重新验证邮箱]}}`；503 `{error:"注册服务暂不可用，请稍后再试"}`；429 |

### 密码重设

| 方法/路径 | 请求体 | 成功响应 | 错误 |
|---|---|---|---|
| POST `/api/auth/password/forgot` | `{email}` | **恒** 200 `{success:true}`（防枚举） | 400 格式错误；429 |
| GET `/api/auth/password/reset-link?token=` | — | 302 → `/reset-password?ticket=<原token>` | 302 → `/reset-password?invalid=1` |
| POST `/api/auth/password/reset` | `{ticket, password}` | 200 `{success:true}` | 400 `{error:{ticket:["重设链接无效，请重新申请"\|"重设链接已过期，请重新申请"\|"重设链接已被使用，请重新申请"]}}`；429 |

**错误展示约定**（沿用现有模式）：`error` 为对象时按字段定位 `aria-invalid` + `role="alert"`（`useId()` 生成 id + `aria-describedby`）；为字符串时显示在表单顶部（errorField=null）。文案直接展示后端消息。

### 登录拦截（后端已实现）

- 未验证邮箱登录返回 `signIn` 的 `result.code === "email_not_verified"`（`CredentialsSignin` 子类），登录页需区分提示：「该邮箱尚未完成验证，请查收验证邮件并完成注册」（errorField=email）
- 密码重设后旧会话 ≤60s 失效（jwt callback 已处理，前端无需做）

## 前端任务清单

### 1. Stepper 组件扩展（`src/components/ui/stepper.tsx`）

现有实现是**同步切步**（`transitionTo` 内同步调用 `onStepChange`），需扩展（保持对旧调用方 `file-upload.tsx`、`projects/new/page.tsx` 兼容，它们传的 `onStepChange` 返回 void）：

- `onStepChange: (next) => void | Promise<void>`：**await 成功后才切步**，reject/throw 停在原步
- `onComplete: () => void | Promise<void>`：同样支持异步（最终提交）
- 新 prop `allowForwardJump?: boolean`（默认 `true`；注册场景传 `false`——已完成步骤仍可回跳，未来步骤不可点）
- 新 prop `pendingLabel?: string`：await 期间 Next 按钮文案（如「发送中…」），按钮显示 `Loader2`（`animate-spin`）并 disabled；用 ref 计数防连点竞态
- 当前步指示器 `aria-current="step"`；内容容器 `role="group"` + `aria-labelledby`（每步标题 id）
- 焦点管理：内容容器 ref `tabIndex={-1}`，步骤切换动画结束后（`onTransitionEnd` 或 200ms 兜底；`prefers-reduced-motion` 时立即）`ref.current?.focus()`
- 移动端：指示器按钮 `touch-action: manipulation`、`min-h-11 min-w-11`
- 现有 `.stepper-content` 动效与 reduced-motion 降级已在 `globals.css`，直接复用

### 2. 注册页重写（`src/app/(auth)/register/page.tsx`）

四步 Stepper（`allowForwardJump={false}`）：**邮箱 → 验证 → 设置密码 → 完成**

| 步骤 | 交互 | 异步动作 | isValid 依据 |
|---|---|---|---|
| 1 邮箱 | email Input（沿用现有样式与 aria 模式） | 点「发送验证邮件」→ `POST /verify/send`；成功后显示「已发送，请查收」+ **60s 倒计时「重新发送」**（`resendAfter`） | email 通过 zod 校验且发送成功（await） |
| 2 验证 | 6 位验证码 Input（`inputMode="numeric"`、`maxLength=6`）+ 提示「或点击邮件中的验证链接」 | 点「验证」→ `POST /verify/code` → 得 `ticket` 存入 state | 已得 ticket（onNext await 内校验） |
| 3 密码 | 密码（min 8）+ 确认密码（建议加） | 「创建账户」（onComplete）→ `POST /register {email,password,ticket}` | 密码合法且注册成功 |
| 4 完成 | 成功页 + 「去登录」按钮 | — | 恒 true |

链接通道衔接：`/register?verified=1&ticket=<t>&email=<e>` 进入时（`useSearchParams`，需包 `Suspense`，登录页已有先例）校验参数形状 → 直接置 email/ticket 状态并**跳到密码步**；ticket 非法/过期在注册提交时兜底报错（后端返回 400 ticket 错误）并回退第 1 步重新验证。`/register?verify=failed` 进入时显示「验证链接已失效，请重新验证」提示。

其他要求：
- Stepper 步骤标题：邮箱 / 验证 / 设置密码 / 完成
- 发送验证邮件失败（409 已注册）：errorField=email 显示「该邮箱已被注册」，并提供「去登录」链接
- 注册成功后：`router.push("/login?registered=true")`（登录页已处理该参数，沿用）

### 3. 登录页（`src/app/(auth)/login/page.tsx`）

- 表单下加「忘记密码？」链接 → `/forgot-password`（`text-[var(--color-accent)]`，样式同现有互链）
- 处理 `result.code === "email_not_verified"`：显示「该邮箱尚未完成验证，请查收验证邮件并完成注册」（errorField=email）
- `?reset=done` 参数：显示「密码已重置，请重新登录」成功提示（与 `?registered=true` 模式一致）

### 4. 新建 `/forgot-password`（`src/app/(auth)/forgot-password/page.tsx`）

- `AuthShell`（title/subtitle/footer 复用现有组件）包裹的邮箱表单
- 提交 `POST /api/auth/password/forgot`，**成功文案统一**：「如果该邮箱已注册，重设邮件已发送」（防枚举，不区分存在与否）
- 429 时显示「请求太频繁，请稍后再试」

### 5. 新建 `/reset-password`（`src/app/(auth)/reset-password/page.tsx`）

- `?ticket=` 读取（`useSearchParams` + `Suspense`）：无/坏 ticket（`?invalid=1`）→ 显示「重设链接已失效或已过期，请重新申请」+ 返回忘记密码链接
- 有 ticket：新密码 + 确认密码 → `POST /api/auth/password/reset {ticket, password}`
- 成功 → `router.push("/login?reset=done")`
- 400 ticket 类错误 → 显示后端文案 + 「重新申请」链接

### 6. 路由保护（后端已改，前端确认即可）

- `src/proxy.ts` matcher 已加 `/forgot-password`、`/reset-password`；`auth.config.ts` 的 `authorized()` 已放行这两个路径（未登录可访问）
- `/api/webhooks/**` **不在** matcher 中，勿添加

## UI 约束（AGENTS.md，必须遵守）

- 按钮/卡片禁止可见边框（无 `border`/`ring`/`outline`/描边 shadow），hover/active/selected/focus-visible 用半透明浅灰、轻色填充、文字/图标权重或扁平 spotlight；**禁止深灰块**（slate/zinc 800/900 类）
- 状态表达只用扁平方式：背景填充、文字/图标权重、轻微色彩变化
- focus-visible 用 `--color-accent-soft` 背景填充（不用 ring/border）
- 复用 token：`--color-accent/-hover/-muted/-soft`、`--color-error`、`--color-surface`、`--radius-md`(10px)/`--radius-lg`(14px)
- 认证页组件：`AuthShell`、`Input`、`Button`（参考现有 register/login 页写法）
- 错误统一 `role="alert"` + `aria-describedby` 模式

## 完成标准与验证

- `npm run lint`、`npx tsc --noEmit`、`npm test`、`npm run build` 全绿
- 手动验证（本地 `npm run dev`，未配置 SES 时邮件走 dry-run 打印到控制台）：
  1. 注册全流程：发验证邮件 → 验证码通道验证 → 设密码 → 创建成功 → 登录
  2. 链接通道：邮件中的链接 → 跳注册页直达密码步 → 注册成功
  3. 验证码错误 4 次后第 5 次提示「尝试次数过多」；重新发送后恢复
  4. 未验证邮箱（需数据库手工造无 `emailVerifiedAt` 的用户）登录 → 提示未验证
  5. 忘记密码：不存在邮箱返回统一提示；存在邮箱 → 邮件链接 → 设新密码 → 旧会话 60s 内失效
  6. Stepper：键盘导航（Tab/Enter）、连点防抖、reduced-motion（系统设置开启）、移动端触控目标
- 更新 `REPOSITORY_INDEX.md` 后提交推送（`feat: ...`）

## 明确不做（后端已做/用户侧）

- 不改任何 `src/app/api/auth/**`、`src/lib/email/**`、`src/lib/auth-challenge.ts`、`src/lib/password-reset.ts`、`src/lib/auth.ts`、`src/lib/auth.config.ts`
- 腾讯云 SES 模板创建与审核、回调地址配置、Nginx 8080 监听、生产部署（等待用户后续操作）
