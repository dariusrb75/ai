package dev.offlinechess.app

import java.net.Inet4Address
import java.net.NetworkInterface

/** One reachable address the guest phone could use. */
data class HostAddress(val ip: String, val interfaceName: String, val likelyHotspot: Boolean) {
    fun url(port: Int): String = "http://$ip:$port/"
}

object HostInfo {

    /**
     * Every non-loopback IPv4 address on the device, best candidate first.
     *
     * The addresses are listed rather than guessed because the hotspot subnet is not consistent:
     * it is often 192.168.43.1 (the long-standing Android default) but OEMs use others, and if
     * both phones are on someone's router instead the address is different again. Showing the
     * real list means the guest never has to guess.
     */
    fun addresses(): List<HostAddress> {
        val found = mutableListOf<HostAddress>()
        try {
            for (nic in NetworkInterface.getNetworkInterfaces()) {
                if (!nic.isUp || nic.isLoopback) continue
                for (address in nic.inetAddresses) {
                    if (address !is Inet4Address || address.isLoopbackAddress) continue
                    val ip = address.hostAddress ?: continue
                    found += HostAddress(
                        ip = ip,
                        interfaceName = nic.name,
                        likelyHotspot = isHotspotLike(nic.name, ip),
                    )
                }
            }
        } catch (e: Exception) {
            // A phone with an odd network stack must not crash the setup screen.
            return emptyList()
        }
        // Hotspot candidates first, then plain Wi-Fi, then anything else.
        return found.sortedWith(
            compareByDescending<HostAddress> { it.likelyHotspot }
                .thenByDescending { it.interfaceName.startsWith("wlan") }
                .thenBy { it.ip }
        )
    }

    /** Tethering interfaces are conventionally named ap0 or swlan0, and 192.168.43.x is the
     *  long-standing Android AP subnet. */
    private fun isHotspotLike(interfaceName: String, ip: String): Boolean {
        val name = interfaceName.lowercase()
        return name.startsWith("ap") ||
            name.startsWith("swlan") ||
            name.startsWith("wlan1") ||
            ip.startsWith("192.168.43.")
    }

    fun best(): HostAddress? = addresses().firstOrNull()
}
