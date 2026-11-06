package crowtech.crowhr.security

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal

/**
 * The platform BiometricPrompt (API 29+), with the device PIN, pattern or password as fallback.
 * No androidx.biometric dependency.
 */
object Biometric {
    /** True when the phone has a screen lock, so unlock can be offered. */
    fun available(context: Context): Boolean {
        val keyguard = context.getSystemService(KeyguardManager::class.java)
        if (keyguard?.isDeviceSecure != true) return false
        return if (Build.VERSION.SDK_INT >= 30) {
            val m = context.getSystemService(BiometricManager::class.java)
            m?.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL) ==
                BiometricManager.BIOMETRIC_SUCCESS
        } else {
            true
        }
    }

    fun prompt(activity: Activity, onSuccess: () -> Unit, onFailure: (String) -> Unit) {
        val builder = BiometricPrompt.Builder(activity)
            .setTitle("Unlock Crow HR")
            .setSubtitle("Use your fingerprint, face or screen lock")
        if (Build.VERSION.SDK_INT >= 30) {
            builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
        } else {
            @Suppress("DEPRECATION")
            builder.setDeviceCredentialAllowed(true)
        }
        builder.build().authenticate(
            CancellationSignal(),
            activity.mainExecutor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = onFailure(errString.toString())
            },
        )
    }
}
