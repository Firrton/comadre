/**
 * Comadre Mobile — convenience hook for AuthContext.
 *
 * Re-exports the auth context value with a friendlier name.
 * Screens consume `useAuth()` instead of importing the context directly.
 */

export { useAuthContext as useAuth } from "../providers/AuthProvider";
