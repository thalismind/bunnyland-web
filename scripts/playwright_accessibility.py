"""Shared axe-core assertions for release-critical browser journeys."""

from __future__ import annotations

from pathlib import Path


AXE_PATH = Path(__file__).resolve().parents[1] / "node_modules" / "axe-core" / "axe.min.js"
RELEASE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]


def assert_accessible(page, state: str) -> None:
    """Fail when the current document has a serious or critical WCAG violation."""

    if not AXE_PATH.is_file():
        raise RuntimeError(f"axe-core is not installed at {AXE_PATH}")
    if not page.evaluate("() => typeof window.axe !== 'undefined'"):
        page.add_script_tag(path=str(AXE_PATH))
    violations = page.evaluate(
        """
        async (tags) => {
          const result = await window.axe.run(document, {
            resultTypes: ['violations'],
            runOnly: { type: 'tag', values: tags },
          });
          return result.violations
            .filter((violation) => ['critical', 'serious'].includes(violation.impact))
            .map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              help: violation.help,
              nodes: violation.nodes.map((node) => ({
                target: node.target,
                summary: node.failureSummary,
              })),
            }));
        }
        """,
        RELEASE_TAGS,
    )
    if violations:
        raise AssertionError(f"{state} has serious or critical axe violations: {violations!r}")
