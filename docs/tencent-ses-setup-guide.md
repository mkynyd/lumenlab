# 腾讯云 SES 邮件配置指南（LumenLab 认证邮件）

> 适用：邮箱验证 + 密码重设邮件发送（腾讯云 SES，香港地域 `ap-hongkong`，HTTPS API 发信）
> 最后更新：2026-08-06

## 已完成的前置工作（无需重复）

- DNS 已核对：MX=`mxbiz1.qq.com`、SPF=`include:qcloudmail.com`、DKIM=`qcloudhk2048`、DMARC `p=none`（`mail.mkynstudio.top` 域）
- 服务器 Nginx 已监听 **8080**（TLS，复用 `lab.mkynstudio.top` 证书），仅开放 `/api/webhooks/tencent-ses` 路径，其余 404；已烟测 8080 可达、TLS 握手正常
- 应用代码已完成：SES 客户端、验证/重设邮件编排、回调 Webhook 路由（幂等 + 投递状态机）

## 重要前提

**回调地址必须在应用新代码部署到生产后配置**。当前生产运行的是旧版本（无 `/api/webhooks/tencent-ses` 路由），腾讯云回调会收到 404。部署顺序：kimi 完成 P4 前端 → 合并提交 → 按 AGENTS.md 流程部署 → 再配置回调。

模板创建后模板 ID 填入服务器 `.env`（未填时应用自动 dry-run，不崩溃、不发真邮件）。

---

## 步骤 1：确认发信域名已验证

控制台（console.cloud.tencent.com/ses）→ 邮件配置 → 发信域名。

`mail.mkynstudio.top` 应显示**已验证**（DNS 记录已存在，若腾讯云后台尚未探测通过，点「验证」重新探测）。

## 步骤 2：创建发信地址

邮件配置 → 发信地址 → 新建发信地址：

- 发信域名：`mail.mkynstudio.top`
- 邮箱地址：`LumenLab`（完整地址 `LumenLab@mail.mkynstudio.top`）

创建后状态应显示「已验证」。（可选）可再建 `support@mail.mkynstudio.top` 作为回复邮箱，但**阶段一不设置 Reply-To**，收信能力后续再配。

## 步骤 3：创建邮件模板（2 个，需审核）

邮件配置 → 发信模板 → 新建发信模板。**模板类型选「HTML 富文本」**（内容以文字为主，兼容性最好；如腾讯云支持，可再建同名纯文本版本）。

审核周期：工作日 1 个工作日内。触发类（验证码）邮件无字数要求。变量与文字比例不超过 1:5。

### 模板 1：邮箱验证（模板名建议 `lumenlab-email-verify`）

变量：`{{code}}`（6 位验证码）、`{{verifyUrl}}`（一次性验证链接）

HTML 正文：

```html
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#f6f7fb;font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:14px;padding:32px;">
    <h1 style="font-size:18px;color:#1a1d29;margin:0 0 16px;">LumenLab 邮箱验证</h1>
    <p style="font-size:14px;color:#4a4f63;line-height:1.7;margin:0 0 16px;">您好！您正在注册 LumenLab 账户，请使用以下验证码完成验证：</p>
    <div style="font-size:32px;font-weight:600;letter-spacing:8px;color:#5a5fe1;text-align:center;padding:16px 0;margin:0 0 16px;">{{code}}</div>
    <p style="font-size:14px;color:#4a4f63;line-height:1.7;margin:0 0 8px;">或点击以下链接完成验证（60 分钟内有效，链接一次性使用）：</p>
    <p style="margin:0 0 16px;"><a href="{{verifyUrl}}" style="display:inline-block;background:#5a5fe1;color:#ffffff;text-decoration:none;padding:10px 24px;border-radius:10px;font-size:14px;">完成邮箱验证</a></p>
    <p style="font-size:12px;color:#8a8fa3;line-height:1.7;margin:0;">验证码 15 分钟内有效。如果这不是您的操作，请忽略本邮件，您的账户不会受到影响。</p>
  </div>
</body>
</html>
```

纯文本版本（备选/参考）：

```text
LumenLab 邮箱验证

您好！您正在注册 LumenLab 账户，请使用以下验证码完成验证：

验证码：{{code}}（15 分钟内有效）

或点击以下链接完成验证（60 分钟内有效，链接一次性使用）：
{{verifyUrl}}

如果这不是您的操作，请忽略本邮件，您的账户不会受到影响。

LumenLab 团队
```

### 模板 2：密码重设（模板名建议 `lumenlab-password-reset`）

变量：`{{resetUrl}}`（一次性重设链接，60 分钟有效）

HTML 正文：

```html
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background-color:#f6f7fb;font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:14px;padding:32px;">
    <h1 style="font-size:18px;color:#1a1d29;margin:0 0 16px;">LumenLab 密码重设</h1>
    <p style="font-size:14px;color:#4a4f63;line-height:1.7;margin:0 0 16px;">您好！我们收到了您的密码重设申请，请点击以下链接设置新密码（60 分钟内有效，链接一次性使用）：</p>
    <p style="margin:0 0 16px;"><a href="{{resetUrl}}" style="display:inline-block;background:#5a5fe1;color:#ffffff;text-decoration:none;padding:10px 24px;border-radius:10px;font-size:14px;">设置新密码</a></p>
    <p style="font-size:12px;color:#8a8fa3;line-height:1.7;margin:0;">如果这不是您的操作，请忽略本邮件，您的密码不会被修改。</p>
  </div>
</body>
</html>
```

纯文本版本（备选/参考）：

```text
LumenLab 密码重设

您好！我们收到了您的密码重设申请，请点击以下链接设置新密码（60 分钟内有效，链接一次性使用）：

{{resetUrl}}

如果这不是您的操作，请忽略本邮件，您的密码不会被修改。

LumenLab 团队
```

### 审核被拒的备选方案

若审核以「链接未保留域名」拒绝（规范要求 URL 至少保留域名部分），把模板中链接改为域名静态 + token 变量：

- 验证模板：`<a href="https://lab.mkynstudio.top/api/auth/verify/link?token={{verifyToken}}">`，变量 `{{code}}`、`{{verifyToken}}`
- 重设模板：`<a href="https://lab.mkynstudio.top/api/auth/password/reset-link?token={{resetToken}}">`，变量 `{{resetToken}}`

对应需改应用代码：`src/lib/email/service.ts` 的 `templateData` 传 `verifyToken`/`resetToken`（`${challengeId}.${rawToken}`）替代完整 URL（含 `ses-client.test.ts`、`service.test.ts` 断言），并同步更新本指南与 `docs/auth-email-frontend-handoff.md`。

## 步骤 4：创建 API 密钥（SecretId / SecretKey）

访问管理（console.cloud.tencent.com/cam/capi）→ API 密钥管理 → 新建密钥（或使用已有）。

建议**新建专用子账号/密钥**（最小权限：仅 SES 发信），不要用主账号密钥。记录 `SecretId` 与 `SecretKey`，下一步填入服务器 `.env`。

## 步骤 5：安全组放行 8080（腾讯云控制台）

服务器 `119.29.216.113` → 安全组 → 添加入站规则：

- 协议端口：**TCP:8080**
- 来源：`0.0.0.0/0`（腾讯云 SES 回调来源 IP 不固定，无法精确限定；8080 上仅开放 webhook 路径，风险可控）
- 策略：允许

## 步骤 6：部署新代码（在模板与安全组就绪后）

1. kimi 完成 P4 前端并合并到 `main`，推送
2. CI 全绿后，用部署脚本发布（目标 commit 含 `3a69cda` 及后续前端提交）
3. 部署后验证 webhook 可访问：

```bash
# 在服务器上（或本机公网测试）
curl -sk https://lab.mkynstudio.top:8080/api/webhooks/tencent-ses \
  -H "content-type: application/json" -d '{"event":"delivered","email":"smoke@example.com"}'
# 期望返回 200 {"ok":true}（安全组放行后可从公网直接测）
```

## 步骤 7：配置服务器 .env

编辑 `/www/wwwroot/course-ai-lab/.env`（部署脚本共享，勿提交 Git），追加：

```bash
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
SES_ENABLED=1
SES_REGION=ap-hongkong
SES_FROM_EMAIL=LumenLab@mail.mkynstudio.top
SES_FROM_NAME=LumenLab
SES_TEMPLATE_VERIFY=模板1的模板ID（审核通过后填写，如 100234）
SES_TEMPLATE_RESET=模板2的模板ID
```

注意：`.env` 修改后需重启服务生效（`systemctl restart lumenlab`）；生产 `.env` 在 release 目录之外共享，重启即可，无需重新部署。**模板 ID 未填之前不要重启为发信状态**——未填时应用 dry-run（控制台打印邮件内容），可先联调流程再填。

## 步骤 8：配置账户级回调（部署 + 安全组放行后）

邮件配置 → 回调地址 → 新建：

- 回调类型：**账户级回调**（两个发信地址共用一个回调）
- 回调地址：`https://lab.mkynstudio.top:8080/api/webhooks/tencent-ses`
- 事件勾选：`delivered`、`deferred`、`bounce`、`dropped`、`spamreport`（`open`/`click` 阶段一不需要，勾不勾不影响——应用侧只记录不阻断）

配置后腾讯云会在投递事件发生时 POST 到该地址。验证：

```bash
# 服务器查询回调日志表（数据库 course_ai_lab）
sudo -u postgres psql -d course_ai_lab -c 'SELECT "event", email, "bulkId", "createdAt" FROM "EmailLogEvent" ORDER BY "createdAt" DESC LIMIT 10;'
```

## 端到端验证清单

1. 模板审核通过 → 填 `SES_TEMPLATE_*` → 重启服务
2. 本地/线上注册一个邮箱 → 收到真实验证邮件（含验证码 + 链接）
3. 验证码通道验证成功 → 完成注册 → 登录成功
4. 密码重设：forgot → 收到重设邮件 → 设置新密码 → 旧会话失效
5. 发送后观察 `EmailLogEvent`：出现 `delivered`（投递成功）；人为用不存在的地址发一封 → 出现 `bounce` + `hard_bounce` → 该地址后续不再发送
