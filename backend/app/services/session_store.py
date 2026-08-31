import json
import logging
import os
import threading

logger = logging.getLogger(__name__)

_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "sessions.json")
_lock = threading.Lock()


class PersistentSessions(dict):
    """Session store that survives server restarts."""

    def __init__(self):
        super().__init__()
        self._path = os.path.abspath(_PATH)
        try:
            if os.path.exists(self._path):
                with open(self._path, "r", encoding="utf-8") as f:
                    self.update(json.load(f))
                logger.info("Restored %d sessions from disk", len(self))
        except Exception as e:
            logger.warning("Could not restore sessions: %s", e)

    def _save(self):
        try:
            with _lock:
                with open(self._path, "w", encoding="utf-8") as f:
                    json.dump(dict(self), f, default=str)
        except Exception as e:
            logger.warning("Session save failed: %s", e)

    def __setitem__(self, k, v):
        super().__setitem__(k, v)
        self._save()

    def pop(self, k, d=None):
        r = super().pop(k, d)
        self._save()
        return r


sessions = PersistentSessions()
archive = PersistentSessions()
archive._path = os.path.abspath(os.path.join(os.path.dirname(_PATH), "archived_summaries.json"))
try:
    if os.path.exists(archive._path):
        import json as _json
        with open(archive._path, "r", encoding="utf-8") as f:
            archive.update(_json.load(f))
except Exception as e:
    logger.warning("Archive restore failed: %s", e)
