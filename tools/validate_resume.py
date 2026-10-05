import json
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path.cwd()
PDF = ROOT / "resume.pdf"
OUT = ROOT / "validation-result.json"

result = {
    "valid": False,
    "stage": "validation",
    "pages": None,
    "text_extractable": False,
    "text_characters": 0,
    "errors": [],
}

if not PDF.exists():
    result["errors"].append("resume.pdf was not generated.")
    OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    sys.exit(2)

try:
    reader = PdfReader(str(PDF))
    pages = len(reader.pages)
    text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()

    result["pages"] = pages
    result["text_characters"] = len(text)
    result["text_extractable"] = len(text) >= 80

    if pages != 1:
        result["errors"].append(f"Expected exactly 1 page, found {pages}.")
    if not result["text_extractable"]:
        result["errors"].append("The generated PDF did not contain enough extractable text.")

    result["valid"] = not result["errors"]
except Exception as exc:
    result["errors"].append(f"Could not inspect PDF: {exc}")

OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
sys.exit(0 if result["valid"] else 2)
