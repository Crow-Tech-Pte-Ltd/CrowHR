package crowtech.crowhr.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/** EXIF orientation → upright transform (the pixel work is checked on a device in UprightPhotoTest). */
class ImagesTest {
    @Test fun everyExifOrientationIsTurnedUpright() {
        val expected = mapOf(
            1 to Images.Upright(0, false),
            2 to Images.Upright(0, true),
            3 to Images.Upright(180, false),
            4 to Images.Upright(180, true),
            5 to Images.Upright(90, true),
            6 to Images.Upright(90, false),
            7 to Images.Upright(270, true),
            8 to Images.Upright(270, false),
        )
        expected.forEach { (tag, upright) -> assertEquals("orientation $tag", upright, Images.upright(tag)) }
        // Missing or invalid tags leave the photo as it is.
        assertEquals(Images.Upright(0, false), Images.upright(0))
        assertEquals(Images.Upright(0, false), Images.upright(9))
    }
}
