/**
 * 用户反馈管理员通知：反馈落库后给 ADMIN_EMAILS 逐个发 SES 模板邮件。
 *
 * 尽力而为通道：任何失败（限流、SES 错误、写日志失败）都只 console.error，
 * 绝不向外抛，绝不阻断反馈接口。未配置 SES / 模板时由 ses-client 降级 dry-run。
 */

import "server-only";
import { prisma } from "@/lib/db";
import { checkRateLimit, RateLimits } from "@/lib/rate-limit";
import { getAdminEmails } from "@/lib/admin";
import { sendTemplateEmail } from "@/lib/email/ses-client";
import {
  buildFeedbackSubject,
  buildFeedbackTemplateData,
  getFeedbackTemplateId,
} from "@/lib/email/templates";

export interface FeedbackNotificationInput {
  feedbackId: string;
  category: string;
  userEmail: string;
  content: string;
  pagePath: string;
  contact: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  bug: "Bug",
  suggestion: "功能建议",
  other: "其他",
};

export async function sendFeedbackNotificationEmail(
  input: FeedbackNotificationInput
): Promise<void> {
  try {
    const admins = getAdminEmails();
    if (admins.length === 0) return;

    // 全局兜底：反馈本身已有 20 条/人/天，这里再防 SES 配额被打爆
    const limit = await checkRateLimit(
      "feedback-notify",
      RateLimits.FEEDBACK_NOTIFY.max,
      RateLimits.FEEDBACK_NOTIFY.window
    );
    if (!limit.allowed) return;

    const templateData = buildFeedbackTemplateData({
      category: CATEGORY_LABEL[input.category] ?? input.category,
      userEmail: input.userEmail,
      pagePath: input.pagePath,
      contact: input.contact ?? "未填写",
      time: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
      content: input.content,
    });

    const templateId = getFeedbackTemplateId() ?? "";

    for (const [index, email] of admins.entries()) {
      const log = await prisma.emailLog.create({
        data: {
          kind: "feedback-notify",
          email,
          templateId,
          event: "sending",
        },
        select: { id: true },
      });

      const result = await sendTemplateEmail({
        to: email,
        subject: buildFeedbackSubject(),
        templateId,
        templateData,
        smtpMessageId: `<feedback-notify-${input.feedbackId}-${index}@mail.mkynstudio.top>`,
        headers: { "X-Tencentcloudses-Cb-Kind": "feedback-notify" },
      });

      if (!result.ok) {
        await prisma.emailLog.update({
          where: { id: log.id },
          data: { event: "failed", payload: { error: result.error } },
        });
        console.error("反馈通知邮件发送失败", email, result.error);
        continue;
      }

      await prisma.emailLog.update({
        where: { id: log.id },
        data: {
          event: "sent",
          bulkId: result.bulkId,
          payload: result.dryRun
            ? { dryRun: true, rendered: templateData }
            : { rendered: templateData },
        },
      });
    }
  } catch (error) {
    console.error("反馈通知邮件处理失败", error);
  }
}
