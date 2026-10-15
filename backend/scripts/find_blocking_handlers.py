"""
List async route handlers that never await (they run blocking code on the event loop and stall every
other request). Usage (from backend/):  python scripts/find_blocking_handlers.py app/api/chat.py ...
"""

import ast
import sys


def handlers(path):
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and any(
            isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and isinstance(d.func.value, ast.Name)
            and d.func.value.id == "router" for d in node.decorator_list
        ):
            awaits = [n for n in ast.walk(node) if isinstance(n, (ast.Await, ast.AsyncFor, ast.AsyncWith))]
            yield node.name, node.lineno, len(awaits)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        for name, line, n in handlers(p):
            print(f"{p}:{line} {name}: {'no await (blocks the loop)' if n == 0 else f'{n} await(s)'}")
