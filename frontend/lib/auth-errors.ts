/**
 * Typed Auth Error Codes and Field Mapping for Supabase Auth.
 *
 * Implements strict mapping per WS1 specifications:
 * - Differentiates email vs password fields
 * - Handles rate limits, account disabled, unconfirmed emails
 * - Displays resilient "Database connection failed" on 5xx/timeouts
 */

export type AuthField = "email" | "password" | "confirmPassword" | "global";

export interface MappedAuthError {
  message: string;
  field: AuthField;
  code: string;
  canResendConfirmation?: boolean;
  retryAfterSeconds?: number;
  referenceId?: string;
}

export function mapAuthError(error: unknown, context: "signin" | "signup" | "forgot" | "reset"): MappedAuthError {
  if (!error) {
    return {
      message: "An unknown error occurred.",
      field: "global",
      code: "unknown",
    };
  }

  const errObj = error as { code?: string; message?: string; status?: number; name?: string };
  const rawCode = String(errObj.code || "").toLowerCase();
  const rawMsg = String(errObj.message || "").toLowerCase();
  const status = Number(errObj.status || 0);

  // Network failures & Server 5xx / timeouts
  if (
    errObj.name === "AbortError" ||
    rawMsg.includes("timeout") ||
    rawMsg.includes("failed to fetch") ||
    rawMsg.includes("network error")
  ) {
    return {
      message: "Cannot reach server. Please check your network connection.",
      field: "global",
      code: "NETWORK_ERROR",
    };
  }

  if (status >= 500 || rawMsg.includes("database") || rawMsg.includes("503") || rawCode === "db_unavailable") {
    return {
      message: "Database connection failed. Automated recovery in progress.",
      field: "global",
      code: "DB_UNAVAILABLE",
      retryAfterSeconds: 15,
    };
  }

  // Rate Limiting
  if (rawCode === "over_request_rate_limit" || rawCode === "over_email_send_rate_limit" || status === 429) {
    return {
      message: "Too many attempts. Please wait a few moments before trying again.",
      field: "global",
      code: "RATE_LIMITED",
      retryAfterSeconds: 60,
    };
  }

  // Email not confirmed
  if (rawCode === "email_not_confirmed" || rawMsg.includes("email not confirmed")) {
    return {
      message: "Your email has not been confirmed yet. Please verify your inbox.",
      field: "email",
      code: "EMAIL_NOT_CONFIRMED",
      canResendConfirmation: true,
    };
  }

  // Account disabled
  if (rawCode === "user_banned" || rawMsg.includes("disabled") || rawMsg.includes("banned")) {
    return {
      message: "This account has been disabled. Please contact system support.",
      field: "global",
      code: "ACCOUNT_DISABLED",
    };
  }

  // Context: Sign In
  if (context === "signin") {
    if (rawCode === "invalid_credentials") {
      return {
        message: "Invalid email or password.",
        field: "password",
        code: "INVALID_CREDENTIALS",
      };
    }
    if (rawCode === "user_not_found" || rawMsg.includes("user not found")) {
      return {
        message: "No account found with this email address.",
        field: "email",
        code: "EMAIL_NOT_REGISTERED",
      };
    }
  }

  // Context: Sign Up
  if (context === "signup") {
    if (rawCode === "user_already_exists" || rawCode === "email_exists" || rawMsg.includes("already registered") || rawMsg.includes("already exists")) {
      return {
        message: "This email address is already registered. Please sign in instead.",
        field: "email",
        code: "USER_ALREADY_EXISTS",
      };
    }
    if (rawCode === "weak_password" || rawMsg.includes("password should be at least") || rawMsg.includes("weak")) {
      return {
        message: "Password does not meet security requirements (min 8 characters, letters & numbers).",
        field: "password",
        code: "WEAK_PASSWORD",
      };
    }
    if (rawCode === "signup_disabled" || rawMsg.includes("signups not allowed")) {
      return {
        message: "New user registrations are currently disabled.",
        field: "global",
        code: "SIGNUPS_DISABLED",
      };
    }
  }

  // Context: Forgot & Reset Password
  if (context === "forgot" || context === "reset") {
    if (rawCode === "otp_expired" || rawMsg.includes("expired") || rawMsg.includes("invalid token")) {
      return {
        message: "The password reset link has expired or is invalid. Please request a new one.",
        field: "global",
        code: "LINK_EXPIRED",
      };
    }
  }

  // Generic fallback with logged reference ID
  const refId = Math.random().toString(36).substring(2, 9).toUpperCase();
  console.error(`[Auth Error Ref: ${refId}]`, error);
  return {
    message: `An unexpected authentication error occurred (Ref: ${refId}).`,
    field: "global",
    code: "UNKNOWN_ERROR",
    referenceId: refId,
  };
}
