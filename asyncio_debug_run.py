# Diagnostic runner (not part of the app): start the backend and record, whenever the event loop
# hasn't answered for 1 s, where the main thread is in app code. Writes ../blocking-stacks.txt.
import asyncio
import collections
import logging
import os
import sys
import threading
import time
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(".env", override=False)
import uvicorn  # noqa: E402

logging.basicConfig(level=logging.INFO)
BLOCKS = collections.Counter()
SEP = os.sep


def watchdog(loop, main_ident):
    while True:
        done = threading.Event()
        loop.call_soon_threadsafe(done.set)
        if not done.wait(1.0):
            frame = sys._current_frames().get(main_ident)
            stack = [f"{fs.filename.split('backend')[-1]}:{fs.lineno} {fs.name}"
                     for fs in traceback.extract_stack(frame) if f"{SEP}app{SEP}" in fs.filename]
            key = " <- ".join(reversed(stack[-4:])) or "(outside app code)"
            BLOCKS[key] += 1
            with open("../blocking-stacks.txt", "w", encoding="utf-8") as f:
                for k, n in BLOCKS.most_common(25):
                    f.write(f"{n:5d}  {k}" + chr(10))
            done.wait(5)
        time.sleep(0.2)


class Server(uvicorn.Server):
    async def serve(self, sockets=None):
        loop = asyncio.get_running_loop()
        threading.Thread(target=watchdog, args=(loop, threading.main_thread().ident), daemon=True).start()
        await super().serve(sockets)


Server(uvicorn.Config("app.main:app", host="127.0.0.1", port=8772, timeout_keep_alive=120)).run()
