package crowtech.crowhr.security

/**
 * Small string store. Production uses [EncryptedFileStore] (Keystore-encrypted files in
 * noBackupFilesDir); tests use [InMemoryKeyValueStore].
 */
interface KeyValueStore {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
    fun keys(): Set<String>
    fun clear() = keys().forEach(::remove)
}

class InMemoryKeyValueStore : KeyValueStore {
    private val map = LinkedHashMap<String, String>()
    @Synchronized override fun get(key: String) = map[key]
    @Synchronized override fun put(key: String, value: String) { map[key] = value }
    @Synchronized override fun remove(key: String) { map.remove(key) }
    @Synchronized override fun keys(): Set<String> = map.keys.toSet()
}
