package crowtech.crowhr.connect

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

/**
 * Android 17 local network protection: apps targeting API 37 need the runtime permission
 * ACCESS_LOCAL_NETWORK to open sockets to private-range addresses. Self-hosted servers on a
 * LAN (http://192.168.1.20:8080, crowhr.local) need it; internet servers don't.
 */
object LocalNetwork {
    const val PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK"

    /** Private-range, link-local and .local hosts; loopback is not "local network". */
    fun isLocalHost(host: String): Boolean {
        val h = host.lowercase().removePrefix("[").removeSuffix("]")
        if (h == "localhost" || h.startsWith("127.") || h == "::1") return false
        return ServerAddress.isHttpAllowedHost(h)
    }

    fun allowed(context: Context, host: String): Boolean =
        Build.VERSION.SDK_INT < 37 || !isLocalHost(host) ||
            context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED
}
