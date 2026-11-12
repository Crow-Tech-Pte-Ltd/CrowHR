/**
 * Where to get the Crow HR mobile apps. The Android app is on Google Play; the iPhone and iPad
 * app is still in App Store review, so it has no URL yet and pages say "coming soon" (set
 * APP_STORE_URL when the listing is live). Used by My profile → Mobile app and the try page.
 */
export const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=crowtech.crowhr";
export const APP_STORE_URL: string | null = null;
/** The Android app's package name (Play listing id; `intent://` links name it). */
export const ANDROID_PACKAGE = "crowtech.crowhr";
/** The apps' privacy policy: what the apps and a demo server keep. */
export const APP_PRIVACY_URL = "https://crow.sg/apps/crow-hr/privacy";
