from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class EventTracer:
    """Collects structured events and can append them to a JSONL file."""

    def __init__(self, output_path: Path | None = None) -> None:
        self.session_id = uuid.uuid4().hex[:12]
        self.output_path = output_path
        self.events: list[dict[str, Any]] = []
        if output_path is not None:
            output_path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, event: str, **data: Any) -> dict[str, Any]:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "session_id": self.session_id,
            "event": event,
            **data,
        }
        self.events.append(payload)
        if self.output_path is not None:
            with self.output_path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
        return payload
