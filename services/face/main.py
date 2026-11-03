"""
Face Detection (SCRFD) & Face Recognition (ArcFace) — API Launcher
===================================================================
Starts the FastAPI server for face detection and recognition.
All functionality is exposed via REST API endpoints.

Run:
    python main.py
    python main.py --host 0.0.0.0 --port 8000
"""

import argparse
import logging

from src import settings


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Face Recognition API Server — SCRFD & ArcFace.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Production API launcher. Set FACE_SERVICE_TOKEN before startup."
    )
    parser.add_argument(
        "--host",
        type=str,
        default="0.0.0.0",
        help="Host address to bind the API server (default: 0.0.0.0)."
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port number for the API server (default: 8000)."
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Number of uvicorn worker processes (default: 1)."
    )
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level, logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    args = parse_arguments()

    # Start the FastAPI server
    try:
        import uvicorn
    except ImportError:
        raise RuntimeError("uvicorn is not installed; install the production requirements.")

    uvicorn.run(
        "api:app",
        host=args.host,
        port=args.port,
        workers=args.workers,
    )


if __name__ == "__main__":
    main()
