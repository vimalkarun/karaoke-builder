"""Serial background job runner.

Demucs separation is CPU/GPU-heavy; running more than one at a time on a
personal machine just makes both slower. A single-worker queue keeps jobs
predictable — good enough for a personal tool, revisit if this ever needs
to serve multiple concurrent users (§Phase 5, multi-device).
"""

from __future__ import annotations

import logging
import queue
import threading
from dataclasses import dataclass
from typing import Callable

logger = logging.getLogger("karaoke.jobs")


@dataclass
class _Task:
    job_id: str
    fn: Callable[[], None]


class JobQueue:
    def __init__(self) -> None:
        self._q: "queue.Queue[_Task]" = queue.Queue()
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._thread.start()

    def submit(self, job_id: str, fn: Callable[[], None]) -> None:
        self._q.put(_Task(job_id=job_id, fn=fn))

    def _worker(self) -> None:
        while True:
            task = self._q.get()
            try:
                task.fn()
            except Exception:
                logger.exception("Job %s failed", task.job_id)
            finally:
                self._q.task_done()


job_queue = JobQueue()
