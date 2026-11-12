package crowtech.crowhr.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A tab's last content, per connection, forgotten when that connection's session ends. */
class ScreenMemoryTest {
    @Test fun keptPerConnectionAndClearedPerConnection() {
        val memory = ScreenMemory()
        val a = "https://hr.example.sg|kampong-kopi"
        val b = "https://hr.example.sg|kampong-kopi-2"
        memory.put(ScreenMemory.key(a, "attendance"), "a-attendance")
        memory.put(ScreenMemory.key(a, "payslips"), "a-payslips")
        memory.put(ScreenMemory.key(b, "attendance"), "b-attendance")
        assertEquals("a-attendance", memory.get(ScreenMemory.key(a, "attendance")))
        memory.clear(a)
        assertNull(memory.get(ScreenMemory.key(a, "attendance")))
        assertNull(memory.get(ScreenMemory.key(a, "payslips")))
        // A connection whose key starts with the other's is not touched.
        assertEquals("b-attendance", memory.get(ScreenMemory.key(b, "attendance")))
        memory.clearAll()
        assertNull(memory.get(ScreenMemory.key(b, "attendance")))
    }
}
