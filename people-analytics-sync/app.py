"""
Gunicorn entrypoint compatibility shim.

Kubernetes uses `api_service:app`, but some local/dev tooling may still reference `app:app`.
"""

from api_service import app  # noqa: F401

