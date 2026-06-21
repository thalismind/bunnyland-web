#!/usr/bin/env python3
"""Optional Chromium coverage collection for Playwright regression scripts."""

from __future__ import annotations

from bisect import bisect_right
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import unquote, urlparse


TRUTHY = {"1", "true", "yes", "on"}


class PlaywrightCoverage:
    def __init__(self, slug: str) -> None:
        self.slug = slug
        self.enabled = os.environ.get("BUNNYLAND_PLAYWRIGHT_COVERAGE", "").lower() in TRUTHY
        self.coverage_dir = Path(
            os.environ.get("BUNNYLAND_PLAYWRIGHT_COVERAGE_DIR", "artifacts/playwright-coverage")
        )
        self._active = {}
        self._js_entries = []
        self._css_entries = []
        self._errors: list[str] = []

    def new_page(self, browser, **kwargs):
        page = browser.new_page(**kwargs)
        self.start_page(page)
        return page

    def start_page(self, page) -> None:
        if not self.enabled:
            return
        try:
            session = page.context.new_cdp_session(page)
            style_sheets = {}
            session.on(
                "CSS.styleSheetAdded",
                lambda params: style_sheets.update(
                    {params.get("header", {}).get("styleSheetId"): params.get("header", {})}
                ),
            )
            session.send("DOM.enable")
            session.send("CSS.enable")
            session.send("Debugger.enable")
            session.send("Profiler.enable")
            session.send("CSS.startRuleUsageTracking")
            session.send("Profiler.startPreciseCoverage", {"callCount": True, "detailed": True})
            self._active[id(page)] = {"page": page, "session": session, "style_sheets": style_sheets}
        except Exception as err:  # pragma: no cover - depends on browser support.
            self._errors.append(f"coverage start failed: {err}")

    def collect_page(self, page) -> None:
        if not self.enabled or id(page) not in self._active:
            return
        active = self._active.pop(id(page), None)
        session = active["session"]
        try:
            result = session.send("Profiler.takePreciseCoverage")
            self._js_entries.extend(_scripts_with_source(session, result.get("result", [])))
            session.send("Profiler.stopPreciseCoverage")
        except Exception as err:  # pragma: no cover - diagnostic path for browser failures.
            self._errors.append(f"js coverage stop failed: {err}")
        try:
            result = session.send("CSS.stopRuleUsageTracking")
            self._css_entries.extend(
                _stylesheets_with_source(
                    session,
                    active["style_sheets"],
                    page.url,
                    result.get("ruleUsage", []),
                )
            )
        except Exception as err:  # pragma: no cover - diagnostic path for browser failures.
            self._errors.append(f"css coverage stop failed: {err}")
        try:
            session.detach()
        except Exception:
            pass

    def close_page(self, page) -> None:
        self.collect_page(page)
        page.close()

    def close_browser(self, browser) -> None:
        for active in list(self._active.values()):
            page = active["page"]
            if not page.is_closed():
                self.collect_page(page)
        self.write()
        browser.close()

    def write(self) -> None:
        if not self.enabled:
            return
        self.coverage_dir.mkdir(parents=True, exist_ok=True)
        raw_path = self.coverage_dir / f"{self.slug}.raw.json"
        raw_path.write_text(
            json.dumps(
                {
                    "script": self.slug,
                    "js": self._js_entries,
                    "css": self._css_entries,
                    "errors": self._errors,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        summary = summarize_entries(self.slug, self._js_entries, self._css_entries, self._errors)
        summary_path = self.coverage_dir / f"{self.slug}.summary.json"
        summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print(
            "coverage="
            f"{summary['totals']['covered_lines']}/{summary['totals']['total_lines']} "
            f"({summary['totals']['line_percent']}%) "
            f"summary={summary_path}"
        )


def summarize_entries(slug: str, js_entries: list[dict], css_entries: list[dict], errors: list[str]) -> dict:
    files = {}
    for entry in js_entries:
        _merge_entry(files, "js", entry)
    for entry in css_entries:
        _merge_entry(files, "css", entry)

    records = []
    for source_id, record in sorted(files.items()):
        total_lines = sorted(record["total_lines"])
        covered_lines = sorted(record["covered_lines"] & record["total_lines"])
        records.append(
            {
                "source_id": source_id,
                "path": record["path"],
                "kind": record["kind"],
                "source_hash": record["source_hash"],
                "total_lines": len(total_lines),
                "covered_lines": len(covered_lines),
                "line_percent": _percent(len(covered_lines), len(total_lines)),
                "total": total_lines,
                "covered": covered_lines,
            }
        )

    total = sum(record["total_lines"] for record in records)
    covered = sum(record["covered_lines"] for record in records)
    return {
        "script": slug,
        "totals": {
            "files": len(records),
            "total_lines": total,
            "covered_lines": covered,
            "line_percent": _percent(covered, total),
        },
        "files": records,
        "errors": errors,
    }


def merge_summary_dir(directory: Path) -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    scripts = []
    errors = []
    js_entries = []
    css_entries = []
    for path in sorted(directory.glob("*.raw.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        scripts.append(raw["script"])
        errors.extend(raw.get("errors", []))
        js_entries.extend(raw.get("js", []))
        css_entries.extend(raw.get("css", []))

    summary = summarize_entries("merged", js_entries, css_entries, errors)
    summary["scripts"] = scripts
    summary.pop("script", None)
    return summary


def _merge_entry(files: dict, kind: str, entry: dict) -> None:
    url = entry.get("url") or ""
    path = _coverage_path(url)
    if not path:
        return
    source = entry.get("source") if kind == "js" else entry.get("text")
    if not source or not source.strip():
        return

    total_lines = _source_lines(source)
    if not total_lines:
        return
    if kind == "js":
        covered_lines = _covered_js_lines(source, entry.get("functions", []))
    else:
        covered_lines = _covered_lines(source, _used_ranges(kind, entry))
    source_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()[:16]
    source_id = f"{kind}:{path}"
    if path.endswith(".html"):
        source_id = f"{source_id}#{source_hash}"

    record = files.setdefault(
        source_id,
        {
            "path": path,
            "kind": kind,
            "source_hash": source_hash,
            "total_lines": set(),
            "covered_lines": set(),
        },
    )
    record["total_lines"].update(total_lines)
    record["covered_lines"].update(covered_lines)


def _scripts_with_source(session, scripts: list[dict]) -> list[dict]:
    entries = []
    for script in scripts:
        url = script.get("url") or ""
        if not url:
            continue
        try:
            source = session.send("Debugger.getScriptSource", {"scriptId": script["scriptId"]}).get(
                "scriptSource", ""
            )
        except Exception:
            source = ""
        if not source:
            continue
        entries.append({**script, "source": source})
    return entries


def _stylesheets_with_source(
    session,
    style_sheets: dict,
    page_url: str,
    rule_usage: list[dict],
) -> list[dict]:
    by_sheet: dict[str, list[dict]] = {}
    for usage in rule_usage:
        if not usage.get("used"):
            continue
        by_sheet.setdefault(usage["styleSheetId"], []).append(
            {"start": usage["startOffset"], "end": usage["endOffset"]}
        )

    entries = []
    for sheet_id, ranges in by_sheet.items():
        try:
            text = session.send("CSS.getStyleSheetText", {"styleSheetId": sheet_id}).get("text", "")
        except Exception:
            text = ""
        if not text:
            continue
        header = style_sheets.get(sheet_id, {})
        url = header.get("sourceURL") or page_url
        entries.append({"url": url, "text": text, "ranges": ranges})
    return entries


def _coverage_path(url: str) -> str | None:
    if not url or url.startswith("__"):
        return None
    parsed = urlparse(url)
    path = unquote(parsed.path.lstrip("/"))
    if not path:
        return "index.html"
    if path.startswith(("node_modules/", "npm/", "chrome-extension://")):
        return None
    if not path.endswith((".html", ".js", ".css")):
        return None
    return path


def _source_lines(source: str) -> set[int]:
    return {index for index, line in enumerate(source.splitlines(), start=1) if line.strip()}


def _used_ranges(kind: str, entry: dict) -> list[tuple[int, int]]:
    if kind == "css":
        return [(item["start"], item["end"]) for item in entry.get("ranges", [])]
    ranges = []
    for function in entry.get("functions", []):
        for item in function.get("ranges", []):
            if item.get("count", 0) > 0:
                ranges.append((item["startOffset"], item["endOffset"]))
    return ranges


def _covered_js_lines(source: str, functions: list[dict]) -> set[int]:
    line_spans = _line_spans(source)
    covered = set()
    for function in functions:
        ranges = function.get("ranges", [])
        if _is_whole_script_function(source, function, ranges):
            continue
        for line_number, line_start, line_end in line_spans:
            offset = _first_nonspace_offset(source, line_start, line_end)
            containing = [
                item for item in ranges if item["startOffset"] <= offset < item["endOffset"]
            ]
            if not containing:
                continue
            innermost = min(containing, key=lambda item: item["endOffset"] - item["startOffset"])
            if innermost.get("count", 0) > 0:
                covered.add(line_number)
    return covered


def _is_whole_script_function(source: str, function: dict, ranges: list[dict]) -> bool:
    if function.get("functionName"):
        return False
    if len(ranges) != 1:
        return False
    item = ranges[0]
    return item.get("startOffset") == 0 and item.get("endOffset", 0) >= len(source)


def _covered_lines(source: str, ranges: list[tuple[int, int]]) -> set[int]:
    starts = _line_starts(source)
    covered = set()
    for start, end in ranges:
        if end <= start:
            continue
        first = bisect_right(starts, start)
        last = bisect_right(starts, max(start, end - 1))
        covered.update(range(first, last + 1))
    return covered & _source_lines(source)


def _line_spans(source: str) -> list[tuple[int, int, int]]:
    spans = []
    offset = 0
    for line_number, line in enumerate(source.splitlines(keepends=True), start=1):
        line_end = offset + len(line)
        if line.strip():
            spans.append((line_number, offset, line_end))
        offset = line_end
    return spans


def _first_nonspace_offset(source: str, start: int, end: int) -> int:
    for offset in range(start, end):
        if not source[offset].isspace():
            return offset
    return start


def _line_starts(source: str) -> list[int]:
    starts = [0]
    for index, character in enumerate(source):
        if character == "\n":
            starts.append(index + 1)
    return starts


def _percent(covered: int, total: int) -> float:
    if total <= 0:
        return 100.0
    return round((covered / total) * 100, 2)


def main() -> None:
    import sys

    directory = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("artifacts/playwright-coverage")
    summary = merge_summary_dir(directory)
    output = directory / "coverage-summary.json"
    output.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(
        "coverage_total="
        f"{summary['totals']['covered_lines']}/{summary['totals']['total_lines']} "
        f"({summary['totals']['line_percent']}%) "
        f"summary={output}"
    )


if __name__ == "__main__":
    main()
