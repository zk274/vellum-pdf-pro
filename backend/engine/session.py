"""Multi-document session management, Undo/Redo stack, Safe Save, and Crash Recovery."""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import shutil
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import pikepdf
import pymupdf


@dataclass
class HistoryEntry:
    pdf_bytes: bytes
    action: str
    timestamp: str
    sha256: str


@dataclass
class DocumentSession:
    doc_id: str
    filename: str
    file_path: Optional[str]
    pdf_bytes: bytes
    password: Optional[str] = None
    is_encrypted: bool = False
    encryption_config: Optional[Dict[str, Any]] = None
    dirty: bool = False
    created_at: str = field(
        default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
    )
    updated_at: str = field(
        default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
    )
    undo_stack: List[HistoryEntry] = field(default_factory=list)
    redo_stack: List[HistoryEntry] = field(default_factory=list)
    max_history: int = 35

    def current_hash(self) -> str:
        return hashlib.sha256(self.pdf_bytes).hexdigest()

    def push_mutation(self, new_bytes: bytes, action: str) -> None:
        """Record previous state on the undo stack and apply new PDF bytes."""
        prev_hash = self.current_hash()
        new_hash = hashlib.sha256(new_bytes).hexdigest()
        if prev_hash == new_hash and self.undo_stack:
            return
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        self.undo_stack.append(
            HistoryEntry(
                pdf_bytes=self.pdf_bytes,
                action=action,
                timestamp=now,
                sha256=prev_hash,
            )
        )
        if len(self.undo_stack) > self.max_history:
            self.undo_stack.pop(0)
        self.redo_stack.clear()
        self.pdf_bytes = new_bytes
        self.dirty = True
        self.updated_at = now

    def undo(self) -> Optional[str]:
        if not self.undo_stack:
            return None
        entry = self.undo_stack.pop()
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        self.redo_stack.append(
            HistoryEntry(
                pdf_bytes=self.pdf_bytes,
                action=entry.action,
                timestamp=now,
                sha256=self.current_hash(),
            )
        )
        self.pdf_bytes = entry.pdf_bytes
        self.dirty = len(self.undo_stack) > 0
        self.updated_at = now
        return entry.action

    def redo(self) -> Optional[str]:
        if not self.redo_stack:
            return None
        entry = self.redo_stack.pop()
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        self.undo_stack.append(
            HistoryEntry(
                pdf_bytes=self.pdf_bytes,
                action=entry.action,
                timestamp=now,
                sha256=self.current_hash(),
            )
        )
        self.pdf_bytes = entry.pdf_bytes
        self.dirty = True
        self.updated_at = now
        return entry.action


class SessionManager:
    """Manages active PDF document tabs, undo/redo history, safe saving, and crash recovery."""

    def __init__(self, recovery_dir: Optional[str] = None) -> None:
        self.sessions: Dict[str, DocumentSession] = {}
        default_dir = os.path.expanduser("~/.local/share/vellum-pdf/recovery")
        self.recovery_dir = Path(recovery_dir or os.environ.get("VELLUM_RECOVERY_DIR", default_dir))
        self.recovery_dir.mkdir(parents=True, exist_ok=True)

    def create_blank_document(
        self,
        filename: str = "Untitled.pdf",
        width: float = 595.0,
        height: float = 842.0,
        page_count: int = 1,
    ) -> DocumentSession:
        doc = pymupdf.open()
        for _ in range(max(1, page_count)):
            doc.new_page(width=width, height=height)
        pdf_bytes = doc.tobytes(garbage=2, deflate=True)
        doc.close()

        doc_id = str(uuid.uuid4())
        session = DocumentSession(
            doc_id=doc_id,
            filename=filename,
            file_path=None,
            pdf_bytes=pdf_bytes,
            dirty=False,
        )
        self.sessions[doc_id] = session
        self._write_recovery_snapshot(session)
        return session

    def open_document(
        self,
        pdf_bytes: bytes,
        filename: str = "Document.pdf",
        file_path: Optional[str] = None,
        password: Optional[str] = None,
    ) -> DocumentSession:
        """Open and validate a PDF document, handling encryption or structural repair if needed."""
        is_encrypted = False
        working_bytes = pdf_bytes

        try:
            doc = pymupdf.open(stream=working_bytes, filetype="pdf")
        except Exception as exc:
            # Attempt automatic structural repair via pikepdf/qpdf
            try:
                with pikepdf.open(
                    pymupdf.io.BytesIO(working_bytes)
                    if hasattr(pymupdf, "io")
                    else __import__("io").BytesIO(working_bytes),
                    password=password or "",
                    attempt_recovery=True,
                ) as pdoc:
                    buf = __import__("io").BytesIO()
                    pdoc.save(buf)
                    working_bytes = buf.getvalue()
                doc = pymupdf.open(stream=working_bytes, filetype="pdf")
            except Exception:
                raise ValueError(f"Failed to open or repair corrupted PDF: {exc}") from exc

        try:
            if doc.needs_pass:
                is_encrypted = True
                if not password:
                    raise PermissionError("PDF_PASSWORD_REQUIRED")
                auth = doc.authenticate(password)
                if not auth:
                    raise PermissionError("PDF_INVALID_PASSWORD")
                # Normalize decrypted working bytes in memory for editing while tracking encryption state
                working_bytes = doc.tobytes()
            if len(doc) == 0:
                doc.new_page(width=595, height=842)
                working_bytes = doc.tobytes()
        finally:
            doc.close()

        doc_id = str(uuid.uuid4())
        session = DocumentSession(
            doc_id=doc_id,
            filename=filename,
            file_path=file_path,
            pdf_bytes=working_bytes,
            password=password,
            is_encrypted=is_encrypted,
            dirty=False,
        )
        self.sessions[doc_id] = session
        self._write_recovery_snapshot(session)
        return session

    def get_session(self, doc_id: str) -> DocumentSession:
        if doc_id not in self.sessions:
            raise KeyError(f"Document session '{doc_id}' not found")
        return self.sessions[doc_id]

    def update_session(self, doc_id: str, new_bytes: bytes, action: str) -> DocumentSession:
        session = self.get_session(doc_id)
        session.push_mutation(new_bytes, action=action)
        self._write_recovery_snapshot(session)
        return session

    def undo(self, doc_id: str) -> Dict[str, Any]:
        session = self.get_session(doc_id)
        action = session.undo()
        self._write_recovery_snapshot(session)
        return {
            "undone_action": action,
            "can_undo": len(session.undo_stack) > 0,
            "can_redo": len(session.redo_stack) > 0,
            "undo_count": len(session.undo_stack),
            "redo_count": len(session.redo_stack),
            "dirty": session.dirty,
        }

    def redo(self, doc_id: str) -> Dict[str, Any]:
        session = self.get_session(doc_id)
        action = session.redo()
        self._write_recovery_snapshot(session)
        return {
            "redone_action": action,
            "can_undo": len(session.undo_stack) > 0,
            "can_redo": len(session.redo_stack) > 0,
            "undo_count": len(session.undo_stack),
            "redo_count": len(session.redo_stack),
            "dirty": session.dirty,
        }

    def get_export_bytes(self, doc_id: str) -> bytes:
        """Return the finalized PDF bytes for export or saving, applying encryption if configured."""
        session = self.get_session(doc_id)
        if session.is_encrypted and session.encryption_config:
            from .security_optimize import encrypt_pdf
            cfg = session.encryption_config
            return encrypt_pdf(
                session.pdf_bytes,
                user_password=cfg.get("user_password", ""),
                owner_password=cfg.get("owner_password", ""),
                encryption_level=cfg.get("encryption_level", "AES-256"),
                allow_print=cfg.get("allow_print", True),
                allow_modify=cfg.get("allow_modify", False),
                allow_extract=cfg.get("allow_extract", False),
                allow_annotate=cfg.get("allow_annotate", True),
                allow_forms=cfg.get("allow_forms", True),
                allow_assemble=cfg.get("allow_assemble", False),
            )
        return session.pdf_bytes

    def safe_save(
        self,
        doc_id: str,
        target_path: Optional[str] = None,
        create_backup: bool = True,
    ) -> Dict[str, Any]:
        """
        Safely save a document to disk using an atomic temp-file write + fsync + replace,
        creating a .bak backup of the previous file if requested.
        """
        session = self.get_session(doc_id)
        save_path = target_path or session.file_path
        if not save_path:
            raise ValueError("No target file path specified for saving")

        dest = Path(save_path).expanduser().resolve()
        dest.parent.mkdir(parents=True, exist_ok=True)

        backup_path: Optional[str] = None
        if create_backup and dest.exists():
            bak = dest.with_suffix(dest.suffix + ".bak")
            shutil.copy2(dest, bak)
            backup_path = str(bak)

        bytes_to_write = self.get_export_bytes(doc_id)

        # Write atomically via temporary file in the same directory
        fd, tmp_name = tempfile.mkstemp(prefix=".vellum_save_", suffix=".pdf", dir=str(dest.parent))
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(bytes_to_write)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_name, dest)
        except Exception:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
            raise

        session.file_path = str(dest)
        session.filename = dest.name
        session.dirty = False
        session.updated_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        self._remove_recovery_snapshot(session.doc_id)

        return {
            "saved_path": str(dest),
            "backup_path": backup_path,
            "size_bytes": len(bytes_to_write),
            "sha256": hashlib.sha256(bytes_to_write).hexdigest(),
            "dirty": session.dirty,
        }

    def close_session(self, doc_id: str) -> None:
        if doc_id in self.sessions:
            del self.sessions[doc_id]
        self._remove_recovery_snapshot(doc_id)

    def get_document_summary(self, doc_id: str) -> Dict[str, Any]:
        session = self.get_session(doc_id)
        doc = pymupdf.open(stream=session.pdf_bytes, filetype="pdf")
        try:
            pages_info = []
            for idx, page in enumerate(doc):
                rect = page.rect
                pages_info.append(
                    {
                        "page_index": idx,
                        "page_number": idx + 1,
                        "width_pt": round(rect.width, 2),
                        "height_pt": round(rect.height, 2),
                        "width_mm": round(rect.width * 25.4 / 72.0, 1),
                        "height_mm": round(rect.height * 25.4 / 72.0, 1),
                        "rotation": page.rotation,
                    }
                )
            metadata = doc.metadata or {}
            toc = doc.get_toc()
            return {
                "doc_id": session.doc_id,
                "filename": session.filename,
                "file_path": session.file_path,
                "page_count": len(doc),
                "pages": pages_info,
                "metadata": metadata,
                "bookmarks_count": len(toc),
                "is_encrypted": session.is_encrypted,
                "dirty": session.dirty,
                "size_bytes": len(session.pdf_bytes),
                "sha256": session.current_hash(),
                "can_undo": len(session.undo_stack) > 0,
                "can_redo": len(session.redo_stack) > 0,
                "undo_count": len(session.undo_stack),
                "redo_count": len(session.redo_stack),
                "last_action": session.undo_stack[-1].action if session.undo_stack else None,
                "updated_at": session.updated_at,
            }
        finally:
            doc.close()

    # --- Crash Recovery Methods ---

    def _write_recovery_snapshot(self, session: DocumentSession) -> None:
        try:
            pdf_file = self.recovery_dir / f"{session.doc_id}.pdf"
            meta_file = self.recovery_dir / f"{session.doc_id}.json"
            pdf_file.write_bytes(session.pdf_bytes)
            meta = {
                "doc_id": session.doc_id,
                "filename": session.filename,
                "file_path": session.file_path,
                "dirty": session.dirty,
                "updated_at": session.updated_at,
                "last_action": session.undo_stack[-1].action if session.undo_stack else "Opened",
                "size_bytes": len(session.pdf_bytes),
            }
            meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        except Exception:
            pass

    def _remove_recovery_snapshot(self, doc_id: str) -> None:
        for ext in (".pdf", ".json"):
            p = self.recovery_dir / f"{doc_id}{ext}"
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass

    def list_recoverable_sessions(self) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for meta_file in sorted(self.recovery_dir.glob("*.json")):
            try:
                data = json.loads(meta_file.read_text(encoding="utf-8"))
                pdf_file = self.recovery_dir / f"{data['doc_id']}.pdf"
                if pdf_file.exists():
                    items.append(data)
            except Exception:
                continue
        return items

    def recover_session(self, doc_id: str) -> DocumentSession:
        meta_file = self.recovery_dir / f"{doc_id}.json"
        pdf_file = self.recovery_dir / f"{doc_id}.pdf"
        if not meta_file.exists() or not pdf_file.exists():
            raise FileNotFoundError(f"Recovery snapshot '{doc_id}' not found")
        data = json.loads(meta_file.read_text(encoding="utf-8"))
        pdf_bytes = pdf_file.read_bytes()
        session = DocumentSession(
            doc_id=doc_id,
            filename=data.get("filename", "Recovered.pdf"),
            file_path=data.get("file_path"),
            pdf_bytes=pdf_bytes,
            dirty=bool(data.get("dirty", True)),
        )
        self.sessions[doc_id] = session
        return session

