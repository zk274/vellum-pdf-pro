"""Automated tests for Vellum PDF Pro backend startup, lifecycle, port isolation, and health readiness."""

import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.app import app, _get_library_metadata


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_health_endpoints_and_caching():
    """Verify both /api/health and /health respond with 200 OK and valid metadata."""
    client = TestClient(app)

    res1 = client.get("/api/health")
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["status"] == "ok"
    assert "pymupdf" in data1["libraries"]
    assert "pikepdf" in data1["libraries"]
    assert "pyhanko" in data1["libraries"]

    res2 = client.get("/health")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["status"] == "ok"

    # Test library metadata caching performance
    meta1 = _get_library_metadata()
    meta2 = _get_library_metadata()
    assert meta1 is meta2


def test_custom_port_and_cli_flag():
    """Verify backend starts on an arbitrary dynamic port via --port argument."""
    port = find_free_port()
    repo_root = Path(__file__).resolve().parent.parent

    proc = subprocess.Popen(
        [sys.executable, "-m", "backend.app", "--port", str(port)],
        cwd=str(repo_root),
        env={**os.environ, "PYTHONPATH": str(repo_root)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        # Wait up to 10 seconds for backend to become healthy
        import urllib.request
        ready = False
        url = f"http://127.0.0.1:{port}/api/health"
        for _ in range(40):
            try:
                with urllib.request.urlopen(url, timeout=0.5) as resp:
                    if resp.status == 200:
                        ready = True
                        break
            except Exception:
                time.sleep(0.25)
        assert ready, f"Backend failed to listen on custom port {port}"
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_multi_instance_backend_isolation():
    """Verify two independent backend instances can run simultaneously on different ports without conflict."""
    port1 = find_free_port()
    port2 = find_free_port()
    while port2 == port1:
        port2 = find_free_port()

    repo_root = Path(__file__).resolve().parent.parent

    proc1 = subprocess.Popen(
        [sys.executable, "-m", "backend.app", "--port", str(port1)],
        cwd=str(repo_root),
        env={**os.environ, "PYTHONPATH": str(repo_root)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    proc2 = subprocess.Popen(
        [sys.executable, "-m", "backend.app", "--port", str(port2)],
        cwd=str(repo_root),
        env={**os.environ, "PYTHONPATH": str(repo_root)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        import urllib.request
        ready1 = False
        ready2 = False
        for _ in range(40):
            if not ready1:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port1}/api/health", timeout=0.5) as resp:
                        if resp.status == 200:
                            ready1 = True
                except Exception:
                    pass
            if not ready2:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port2}/api/health", timeout=0.5) as resp:
                        if resp.status == 200:
                            ready2 = True
                except Exception:
                    pass
            if ready1 and ready2:
                break
            time.sleep(0.25)

        assert ready1, f"Instance 1 failed on port {port1}"
        assert ready2, f"Instance 2 failed on port {port2}"
    finally:
        for p in (proc1, proc2):
            p.terminate()
            try:
                p.wait(timeout=2)
            except subprocess.TimeoutExpired:
                p.kill()


def test_packaged_runtime_path_resolution():
    """Verify that backend modules can be imported using standard package paths."""
    repo_root = Path(__file__).resolve().parent.parent
    backend_app_path = repo_root / "backend" / "app.py"
    assert backend_app_path.exists(), "backend/app.py must exist at project root"

    electron_main_path = repo_root / "electron" / "main.cjs"
    assert electron_main_path.exists(), "electron/main.cjs must exist"


def test_clean_process_shutdown():
    """Verify backend terminates cleanly on SIGTERM without zombie processes."""
    port = find_free_port()
    repo_root = Path(__file__).resolve().parent.parent

    proc = subprocess.Popen(
        [sys.executable, "-m", "backend.app", "--port", str(port)],
        cwd=str(repo_root),
        env={**os.environ, "PYTHONPATH": str(repo_root)},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    import urllib.request
    for _ in range(40):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.5) as resp:
                if resp.status == 200:
                    break
        except Exception:
            time.sleep(0.25)

    # Send SIGTERM
    proc.send_signal(signal.SIGTERM)
    exit_code = proc.wait(timeout=5)
    # On SIGTERM, standard uvicorn shutdown exits with 0 or 143 (SIGTERM)
    assert exit_code in (0, -signal.SIGTERM, 143, 15)

