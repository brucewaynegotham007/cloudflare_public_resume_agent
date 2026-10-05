import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path.cwd()

def read_json(path: str, default):
    file = ROOT / path
    if not file.exists():
        return default
    try:
        return json.loads(file.read_text(encoding="utf-8"))
    except Exception:
        return default

compile_result = read_json("compile-result.json", None)
validation_result = read_json("validation-result.json", None)
push_result = read_json("push-result.json", None)

compile_ok = bool(compile_result and compile_result.get("success"))
validation_ok = bool(validation_result and validation_result.get("valid"))
push_ok = bool(push_result and push_result.get("success"))

error_stage = None
if not compile_ok:
    error_stage = "compiler"
elif not validation_ok:
    error_stage = "validation"
elif not push_ok:
    error_stage = "push"

payload = {
    "taskId": os.environ["TASK_ID"],
    "attempt": int(os.environ["ATTEMPT"]),
    "retry": int(os.environ["RETRY"]),
    "success": compile_ok and validation_ok and push_ok,
    "errorStage": error_stage,
    "compile": compile_result,
    "validation": validation_result,
    "push": push_result,
}

url = os.environ["AGENT_CALLBACK_URL"]
token = os.environ["AGENT_CALLBACK_TOKEN"]
body = json.dumps(payload).encode("utf-8")

request = urllib.request.Request(
    url,
    data=body,
    method="POST",
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    },
)

try:
    with urllib.request.urlopen(request, timeout=30) as response:
        print(response.read().decode("utf-8"))
except Exception as exc:
    print(f"Callback failed: {exc}", file=sys.stderr)
    sys.exit(2)
