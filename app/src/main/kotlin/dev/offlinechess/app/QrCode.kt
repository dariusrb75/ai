package dev.offlinechess.app

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/**
 * Renders the join URL as a QR code so the guest points their camera at it instead of typing
 * an IP address. Typing "http://192.168.43.1:8080" correctly on a phone screen, outdoors, is
 * exactly the kind of small friction that turns into "this doesn't work".
 *
 * Generated on-device: zxing is bundled in the APK, so this needs no network.
 */
object QrCode {

    fun render(content: String, sizePx: Int): Bitmap? {
        return try {
            val hints = mapOf(
                // High error correction: the guest is photographing a phone screen that may be
                // dim, glary or smudged.
                EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.H,
                EncodeHintType.MARGIN to 1,
                EncodeHintType.CHARACTER_SET to "UTF-8",
            )
            val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)

            val width = matrix.width
            val height = matrix.height
            val pixels = IntArray(width * height)
            for (y in 0 until height) {
                val offset = y * width
                for (x in 0 until width) {
                    pixels[offset + x] = if (matrix[x, y]) Color.BLACK else Color.WHITE
                }
            }
            Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply {
                setPixels(pixels, 0, width, 0, 0, width, height)
            }
        } catch (e: Exception) {
            // Without a QR code the address is still shown as text, so this is not fatal.
            null
        }
    }
}
