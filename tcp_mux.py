#!/usr/bin/env python3
"""tcp_mux.py — Multiplex SSH and HTTP/HTTPS on a single port.

Peeks at the first bytes of each incoming connection:
  • Starts with b'SSH-'     → forward to local SSH daemon
  • Anything else (HTTP)    → forward to the AMD web server

Usage
-----
    python tcp_mux.py                         # listen :10001, SSH→:22, HTTP→:8000
    python tcp_mux.py --port 10001 --ssh 22 --http 8000

Run as a background service (add to supervisor or start.sh):
    nohup python tcp_mux.py &
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s [mux] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

PEEK_BYTES = 8        # enough to identify SSH-2.0 banner
BUF_SIZE   = 65536


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while True:
            data = await reader.read(BUF_SIZE)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError):
        pass
    finally:
        writer.close()


async def _forward(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    target_host: str,
    target_port: int,
    peeked: bytes,
) -> None:
    peer = client_writer.get_extra_info("peername")
    try:
        up_reader, up_writer = await asyncio.open_connection(target_host, target_port)
        up_writer.write(peeked)
        await up_writer.drain()
        await asyncio.gather(
            _pipe(client_reader, up_writer),
            _pipe(up_reader, client_writer),
        )
    except OSError as exc:
        log.warning("Forward %s → %s:%d failed: %s", peer, target_host, target_port, exc)
    finally:
        client_writer.close()


async def _handle(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    ssh_host: str,
    ssh_port: int,
    http_host: str,
    http_port: int,
) -> None:
    peer = client_writer.get_extra_info("peername")
    try:
        peeked = await asyncio.wait_for(client_reader.read(PEEK_BYTES), timeout=5)
    except asyncio.TimeoutError:
        client_writer.close()
        return

    if peeked.startswith(b"SSH-"):
        log.info("%s → SSH :%d", peer, ssh_port)
        await _forward(client_reader, client_writer, ssh_host, ssh_port, peeked)
    else:
        log.info("%s → HTTP :%d", peer, http_port)
        await _forward(client_reader, client_writer, http_host, http_port, peeked)


async def main(listen_port: int, ssh_port: int, http_port: int) -> None:
    ssh_host  = "127.0.0.1"
    http_host = "127.0.0.1"

    server = await asyncio.start_server(
        lambda r, w: _handle(r, w, ssh_host, ssh_port, http_host, http_port),
        host="0.0.0.0",
        port=listen_port,
    )

    log.info("Listening on 0.0.0.0:%d  →  SSH :%d | HTTP :%d", listen_port, ssh_port, http_port)

    loop = asyncio.get_running_loop()
    stop = loop.create_future()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set_result, None)

    async with server:
        await stop

    log.info("Shutting down.")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="TCP protocol multiplexer (SSH + HTTP)")
    p.add_argument("--port", type=int, default=10001, help="Port to listen on (default: 10001)")
    p.add_argument("--ssh",  type=int, default=22,    help="Local SSH port (default: 22)")
    p.add_argument("--http", type=int, default=8000,  help="AMD web server port (default: 8000)")
    args = p.parse_args()

    try:
        asyncio.run(main(args.port, args.ssh, args.http))
    except KeyboardInterrupt:
        sys.exit(0)
