#!/usr/bin/env python3
"""Local CI reporting helpers for frontend tests and coverage."""

from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
from xml.etree import ElementTree


def write_case(args: argparse.Namespace) -> None:
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    testsuite = ElementTree.Element(
        "testsuite",
        {
            "name": args.suite,
            "tests": "1",
            "failures": "1" if args.status == "failed" else "0",
            "errors": "0",
            "skipped": "0",
            "time": f"{args.time:.3f}",
        },
    )
    testcase = ElementTree.SubElement(
        testsuite,
        "testcase",
        {
            "classname": args.suite,
            "name": args.name,
            "time": f"{args.time:.3f}",
        },
    )
    log = Path(args.log_file).read_text(encoding="utf-8", errors="replace") if args.log_file else ""
    log = _xml_text(log)
    if args.status == "failed":
        failure = ElementTree.SubElement(
            testcase,
            "failure",
            {
                "message": f"{args.name} failed",
                "type": "PlaywrightRegressionFailure",
            },
        )
        failure.text = log[-8000:]
    elif log:
        output_node = ElementTree.SubElement(testcase, "system-out")
        output_node.text = log[-8000:]

    ElementTree.ElementTree(testsuite).write(output, encoding="utf-8", xml_declaration=True)


def summarize(args: argparse.Namespace) -> int:
    report_dir = Path(args.report_dir)
    coverage_file = Path(args.coverage_file)
    merged_output = Path(args.merged_output)
    junit_files = sorted(
        path for path in report_dir.glob("*.xml") if path.resolve() != merged_output.resolve()
    )
    merge_junit(junit_files, merged_output)

    totals = {"tests": 0, "failed": 0, "skipped": 0, "time": 0.0}
    suites = []
    failures = []
    merged = _parse_junit(merged_output)
    totals["tests"] = merged["tests"]
    totals["failed"] = merged["failed"]
    totals["skipped"] = merged["skipped"]
    totals["time"] = merged["time"]
    suites = merged["suites"]
    failures = merged["failures"]

    passed = max(totals["tests"] - totals["failed"] - totals["skipped"], 0)
    coverage = _read_coverage(coverage_file)
    markdown = _markdown_report("Web Test Report", totals, passed, suites, coverage)
    _write_summary(markdown)
    print(markdown)

    for failure in failures[:50]:
        _annotation("error", failure["title"], failure["message"])
    if coverage.get("errors"):
        for error in coverage["errors"][:20]:
            _annotation("warning", "Playwright coverage warning", error)

    return 1 if totals["failed"] else 0


def merge_junit(paths: list[Path], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    root = ElementTree.Element("testsuites")
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0, "time": 0.0}

    for path in paths:
        tree = ElementTree.parse(path)
        source = tree.getroot()
        suites = _suite_nodes(source, path)
        for suite in suites:
            root.append(copy.deepcopy(suite))
            totals["tests"] += _int_attr(suite, "tests", len(list(suite.iter("testcase"))))
            totals["failures"] += _int_attr(suite, "failures", 0)
            totals["errors"] += _int_attr(suite, "errors", 0)
            totals["skipped"] += _int_attr(suite, "skipped", 0)
            totals["time"] += _float_attr(suite, "time", 0.0)

    root.attrib.update(
        {
            "name": "web-tests",
            "tests": str(totals["tests"]),
            "failures": str(totals["failures"]),
            "errors": str(totals["errors"]),
            "skipped": str(totals["skipped"]),
            "time": f"{totals['time']:.3f}",
        }
    )
    ElementTree.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)


def _parse_junit(path: Path) -> dict:
    tree = ElementTree.parse(path)
    root = tree.getroot()
    suite_nodes = _suite_nodes(root, path)
    suite = {
        "file": str(path),
        "name": path.stem,
        "tests": 0,
        "failed": 0,
        "skipped": 0,
        "time": 0.0,
        "suites": [],
        "failures": [],
    }
    for node in suite_nodes:
        name = node.attrib.get("name", suite["name"])
        suite["name"] = name
        cases = list(node.iter("testcase"))
        tests = _int_attr(node, "tests", len(cases))
        failed = _int_attr(node, "failures", 0) + _int_attr(node, "errors", 0)
        skipped = _int_attr(node, "skipped", 0)
        elapsed = _float_attr(node, "time", 0.0)
        suite["tests"] += tests
        suite["failed"] += failed
        suite["skipped"] += skipped
        suite["time"] += elapsed
        suite["suites"].append(
            {
                "name": name,
                "tests": tests,
                "failed": failed,
                "skipped": skipped,
                "time": elapsed,
                "failures": [],
            }
        )
        for case in cases:
            failure = case.find("failure")
            if failure is None:
                failure = case.find("error")
            if failure is None:
                continue
            title = f"{case.attrib.get('classname', suite['name'])}.{case.attrib.get('name', '(unknown)')}"
            message = failure.attrib.get("message") or (failure.text or "").strip() or "test failed"
            suite["failures"].append({"title": title, "message": message})
            suite["suites"][-1]["failures"].append({"title": title, "message": message})
    return suite


def _suite_nodes(root: ElementTree.Element, path: Path) -> list[ElementTree.Element]:
    if root.tag == "testsuite":
        return [root]
    suites = list(root.findall("testsuite"))
    direct_cases = list(root.findall("testcase"))
    if direct_cases:
        wrapper = ElementTree.Element(
            "testsuite",
            {
                "name": path.stem,
                "tests": str(len(direct_cases)),
                "failures": str(sum(1 for case in direct_cases if case.find("failure") is not None)),
                "errors": str(sum(1 for case in direct_cases if case.find("error") is not None)),
                "skipped": str(sum(1 for case in direct_cases if case.find("skipped") is not None)),
                "time": f"{sum(_float_attr(case, 'time', 0.0) for case in direct_cases):.3f}",
            },
        )
        for case in direct_cases:
            wrapper.append(copy.deepcopy(case))
        suites.append(wrapper)
    return suites


def _read_coverage(path: Path) -> dict:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    files = sorted(
        data.get("files", []),
        key=lambda item: (item.get("line_percent", 100.0), item.get("path", "")),
    )
    return {
        "kind": "Playwright JS/CSS",
        "totals": data.get("totals", {}),
        "files": files[:12],
        "errors": data.get("errors", []),
    }


def _markdown_report(title: str, totals: dict, passed: int, suites: list[dict], coverage: dict) -> str:
    lines = [
        f"## {title}",
        "",
        f"| Passed | Failed | Skipped | Total | Time |",
        "| ---: | ---: | ---: | ---: | ---: |",
        f"| {passed} | {totals['failed']} | {totals['skipped']} | {totals['tests']} | {totals['time']:.2f}s |",
        "",
        "### Test Suites",
        "",
        "| Suite | Passed | Failed | Skipped | Total | Time |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for suite in suites:
        suite_passed = max(suite["tests"] - suite["failed"] - suite["skipped"], 0)
        lines.append(
            f"| `{suite['name']}` | {suite_passed} | {suite['failed']} | "
            f"{suite['skipped']} | {suite['tests']} | {suite['time']:.2f}s |"
        )
    if not suites:
        lines.append("| No test result files found | 0 | 0 | 0 | 0 | 0.00s |")

    if coverage:
        totals = coverage["totals"]
        lines.extend(
            [
                "",
                f"### Coverage ({coverage['kind']})",
                "",
                "| Files | Covered lines | Total lines | Line coverage |",
                "| ---: | ---: | ---: | ---: |",
                (
                    f"| {totals.get('files', 0)} | {totals.get('covered_lines', 0)} | "
                    f"{totals.get('total_lines', 0)} | {totals.get('line_percent', 0)}% |"
                ),
                "",
                "<details><summary>Lowest covered frontend files</summary>",
                "",
                "| File | Kind | Line coverage | Covered / Total |",
                "| --- | --- | ---: | ---: |",
            ]
        )
        for item in coverage["files"]:
            lines.append(
                f"| `{item.get('path', '')}` | {item.get('kind', '')} | "
                f"{item.get('line_percent', 0)}% | "
                f"{item.get('covered_lines', 0)} / {item.get('total_lines', 0)} |"
            )
        lines.extend(["", "</details>"])

    return "\n".join(lines) + "\n"


def _write_summary(markdown: str) -> None:
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary:
        return
    with Path(summary).open("a", encoding="utf-8") as handle:
        handle.write(markdown)


def _annotation(level: str, title: str, message: str) -> None:
    print(f"::{level} title={_escape(title)}::{_escape(message)}")


def _escape(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def _xml_text(value: str) -> str:
    """Remove control characters that XML 1.0 cannot represent."""
    return "".join(
        character
        for character in value
        if character in "\t\n\r"
        or "\x20" <= character <= "\ud7ff"
        or "\ue000" <= character <= "\ufffd"
        or "\U00010000" <= character <= "\U0010ffff"
    )


def _int_attr(node: ElementTree.Element, key: str, default: int) -> int:
    try:
        return int(node.attrib.get(key, default))
    except ValueError:
        return default


def _float_attr(node: ElementTree.Element, key: str, default: float) -> float:
    try:
        return float(node.attrib.get(key, default))
    except ValueError:
        return default


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    write = subparsers.add_parser("write-case")
    write.add_argument("--output", required=True)
    write.add_argument("--suite", required=True)
    write.add_argument("--name", required=True)
    write.add_argument("--status", choices=["passed", "failed"], required=True)
    write.add_argument("--time", type=float, required=True)
    write.add_argument("--log-file")
    write.set_defaults(func=write_case)

    summary = subparsers.add_parser("summary")
    summary.add_argument("--report-dir", default="artifacts/test-results")
    summary.add_argument("--merged-output", default="artifacts/test-results/web-tests.xml")
    summary.add_argument("--coverage-file", default="artifacts/playwright-coverage/coverage-summary.json")
    summary.set_defaults(func=summarize)

    args = parser.parse_args()
    result = args.func(args)
    return int(result or 0)


if __name__ == "__main__":
    raise SystemExit(main())
