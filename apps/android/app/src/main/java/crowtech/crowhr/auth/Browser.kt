package crowtech.crowhr.auth

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/** Opens the sign-in page. Never an embedded web view (spec "Native sign-in"). */
fun interface BrowserLauncher {
    /** Returns false when no browser is installed. */
    fun open(context: Context, url: String): Boolean
}

/**
 * Custom Tabs through the documented intent extras, without the androidx.browser library: the
 * user's own browser shows the page (with its address bar), so the app never sees the password
 * or SSO credentials. Falls back to a normal browser window when Custom Tabs aren't supported.
 */
object CustomTabsLauncher : BrowserLauncher {
    private const val EXTRA_SESSION = "android.support.customtabs.extra.SESSION"
    private const val EXTRA_SHARE_STATE = "androidx.browser.customtabs.extra.SHARE_STATE"
    private const val SHARE_STATE_OFF = 2

    override fun open(context: Context, url: String): Boolean {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
            putExtras(Bundle().apply { putBinder(EXTRA_SESSION, null) })
            putExtra(EXTRA_SHARE_STATE, SHARE_STATE_OFF)
            if (context !is android.app.Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            context.startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}
