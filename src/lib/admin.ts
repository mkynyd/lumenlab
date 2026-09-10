/**
 * Legacy environment helper retained for feedback notification recipients.
 * Interactive administration moved to a separately deployed admin console;
 * this module no longer authenticates a main-application user as an administrator.
 */
export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}
