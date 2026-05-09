/**
 * Comadre Mobile — structured error handling.
 *
 * All user-facing messages are in español (LATAM). Error codes are stable
 * strings that the UI can use for conditional rendering. The `AppError`
 * class carries both the machine-readable code and the human message.
 */

/** Stable error codes for conditional UI handling */
export type ErrorCode =
  | "NETWORK_ERROR"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "ONBOARDING_FAILED"
  | "TANDA_FULL"
  | "ALREADY_MEMBER"
  | "SERVER_ERROR"
  | "MOCK_NOT_IMPLEMENTED"
  | "UNKNOWN";

/** User-facing messages in español (LATAM) */
const MESSAGES: Record<ErrorCode, string> = {
  NETWORK_ERROR:
    "Sin conexión. Verificá tu internet e intentá de nuevo.",
  UNAUTHORIZED:
    "Tu sesión expiró. Volvé a ingresar.",
  VALIDATION_ERROR:
    "Revisá los datos ingresados, hay algo que no coincide.",
  NOT_FOUND:
    "No encontramos lo que buscás.",
  ONBOARDING_FAILED:
    "No pudimos crear tu cuenta. Intentá otra vez en unos minutos.",
  TANDA_FULL:
    "Esta tanda ya está completa.",
  ALREADY_MEMBER:
    "Ya formas parte de esta tanda.",
  SERVER_ERROR:
    "Tuvimos un problema. Intentá de nuevo más tarde.",
  MOCK_NOT_IMPLEMENTED:
    "Esta funcionalidad no está disponible en modo demo.",
  UNKNOWN:
    "Algo salió mal. Intentá de nuevo.",
};

/**
 * Application error with stable code and user-facing message.
 *
 * Usage:
 *   throw new AppError("NETWORK_ERROR");
 *   throw new AppError("VALIDATION_ERROR", "El nombre es obligatorio");
 */
export class AppError extends Error {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, overrideMessage?: string) {
    const message = overrideMessage ?? MESSAGES[code];
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

/**
 * Map an HTTP status code and optional API error body to an AppError.
 * Used by the API client to convert fetch errors into typed errors.
 *
 * Expected API error shape: { error: string; message?: string }
 */
export function mapHttpError(
  status: number,
  body?: { error?: string; message?: string },
): AppError {
  switch (status) {
    case 401:
      return new AppError("UNAUTHORIZED");
    case 400:
      return new AppError("VALIDATION_ERROR", body?.message);
    case 404:
      return new AppError("NOT_FOUND", body?.message);
    case 409: {
      const error = body?.error ?? "";
      if (error.includes("FULL") || error.includes("full"))
        return new AppError("TANDA_FULL");
      if (error.includes("ALREADY") || error.includes("already"))
        return new AppError("ALREADY_MEMBER");
      return new AppError("SERVER_ERROR");
    }
    case 500:
    case 502:
    case 503:
      return new AppError("SERVER_ERROR");
    default:
      return new AppError("UNKNOWN");
  }
}
