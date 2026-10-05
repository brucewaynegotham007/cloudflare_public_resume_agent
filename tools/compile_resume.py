import json
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd()
TEX = ROOT / "resume.tex"
PDF = ROOT / "resume.pdf"
OUT = ROOT / "compile-result.json"
LOG = ROOT / "compile.log"

result = {
    "success": False,
    "stage": "compiler",
    "pdf_exists": False,
    "pdf_size_bytes": 0,
    "return_code": None,
    "stderr_tail": "",
}

if not TEX.exists():
    result["stderr_tail"] = "resume.tex was not found."
    OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    sys.exit(2)

try:
    completed = subprocess.run(
        ["tectonic", "--keep-logs", "--keep-intermediates", "resume.tex"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=240,
        check=False,
    )
except FileNotFoundError:
    result["stderr_tail"] = "tectonic executable was not found on the runner."
    OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    sys.exit(2)
except subprocess.TimeoutExpired as exc:
    result["stderr_tail"] = (exc.stdout or "Compilation timed out")[-6000:]
    OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    sys.exit(2)

LOG.write_text(completed.stdout or "", encoding="utf-8")
result["return_code"] = completed.returncode
result["pdf_exists"] = PDF.exists()
result["pdf_size_bytes"] = PDF.stat().st_size if PDF.exists() else 0
result["stderr_tail"] = (completed.stdout or "")[-6000:]
result["success"] = completed.returncode == 0 and PDF.exists() and PDF.stat().st_size > 0

OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
sys.exit(0 if result["success"] else 2)
