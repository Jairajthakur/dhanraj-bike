// App-wide branding constants and helpers.
//
// The app is white-labeled per agency: screens that know which agency the
// logged-in user belongs to (search screens, etc.) show that agency's name
// instead of the generic app name. Screens without a logged-in user yet
// (login) fall back to the generic app identity below.

export const APP_NAME = "Bike Recovery";
export const APP_TAGLINE = "Agency Vehicle Recovery Management";

/**
 * Returns the initial letter to show in the small brand badge/avatar.
 * Prefers the agency's own name, falling back to the app name.
 */
export function brandInitial(agencyName?: string | null): string {
  const source = (agencyName || APP_NAME).trim();
  return source.charAt(0).toUpperCase() || "B";
}

/**
 * Returns an upper-cased display name for the brand strip.
 * Prefers the agency's own name, falling back to the app name.
 */
export function brandNameUpper(agencyName?: string | null): string {
  const source = (agencyName || APP_NAME).trim();
  return source.toUpperCase();
}

/**
 * Footer text shown at the bottom of the login screen.
 */
export function brandFooter(): string {
  const year = new Date().getFullYear();
  return `© ${year} ${APP_NAME}. All rights reserved.`;
}
