"""Generates a self-signed HTTPS certificate for local/LAN use (plan §Phase 5).

Why this exists: browsers only allow microphone access (getUserMedia, used by
Practice mode) on a "secure context" — HTTPS, or exactly `localhost`. Opening
this app from a phone at `http://<lan-ip>:5173` is neither, so the mic simply
never works there, regardless of anything in the app's own code. Serving over
HTTPS instead fixes it for every device on the LAN, still fully self-hosted —
no cloud service or public CA involved, no third party ever sees this cert.

The cert covers localhost, 127.0.0.1, and this machine's current LAN IP(s),
so both the desktop and any phone/tablet on the same Wi-Fi can use it. Since
it's self-signed, every device shows a one-time "connection isn't private"
warning on first visit — that's expected; there's no public CA that will
issue a certificate for a private IP address. Click through it once per
device (Chrome: "Advanced" -> "Proceed"; this is safe, since you generated
the certificate yourself, on your own machine, moments ago).

Re-run this script if your LAN IP changes (e.g. a new DHCP lease) and the
phone can no longer connect.
"""

from __future__ import annotations

import datetime
import ipaddress
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

CERTS_DIR = Path(__file__).resolve().parent.parent / "certs"


def _detect_lan_ips() -> list[str]:
    """Best-effort discovery of this machine's LAN-facing IP address(es)."""
    ips: set[str] = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            # Doesn't actually send anything — just asks the OS which local
            # interface/IP it would use to reach an external address.
            s.connect(("8.8.8.8", 80))
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ips)


def generate() -> tuple[Path, Path]:
    CERTS_DIR.mkdir(parents=True, exist_ok=True)
    key_path = CERTS_DIR / "key.pem"
    cert_path = CERTS_DIR / "cert.pem"

    lan_ips = _detect_lan_ips()
    print(f"Detected LAN IP(s): {', '.join(lan_ips) if lan_ips else '(none found)'}")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "karaoke-builder.local")])

    san_entries: list[x509.GeneralName] = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
    ]
    for ip in lan_ips:
        try:
            san_entries.append(x509.IPAddress(ipaddress.ip_address(ip)))
        except ValueError:
            pass

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=825))  # under browsers' ~825-day cap
        .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path


if __name__ == "__main__":
    cert_path, key_path = generate()
    print(f"Wrote {cert_path}")
    print(f"Wrote {key_path}")
    print()
    print("Run the backend with:")
    print(f'  uvicorn app.main:app --host 0.0.0.0 --port 8000 --ssl-certfile "{cert_path}" --ssl-keyfile "{key_path}"')
