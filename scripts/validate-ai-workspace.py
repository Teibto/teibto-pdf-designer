"""Validate project-scoped coding agents and skill discovery.

@author Wichit Wongta
@since 2026-08-21
"""

from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parents[1]
NAME = re.compile(r"^[a-z][a-z0-9-]*$")


class AgentProfile(NamedTuple):
    description: str
    instructions: str
    read_only: bool


READ_ONLY_AGENTS = {"pdf-explorer", "pdf-parity-reviewer"}
AGENT_REQUIRED_TERMS = {
    "designer-implementer": (
        "designer/**", "assigned by the primary agent", "single bfo generator",
        "agents.md", "claude.md", "do not edit engine/** or templates/**",
        "deploy", "live customer data", "external actions",
    ),
    "engine-template-implementer": (
        "engine/**", "templates/**", "assigned by the primary agent",
        "n/render as the single render path", "master xml as source of truth",
        "null-safe freemarker", "do not edit designer/**", "explicit authorization",
    ),
    "pdf-explorer": (
        "agents.md", "claude.md", "architecture overview", "source-of-truth ownership",
        "bfo/freemarker constraints", "do not edit files", "live netsuite", "external actions",
    ),
    "pdf-parity-reviewer": (
        "agents.md", "claude.md", "divergent render paths", "duplicate generators",
        "null-safe freemarker", "thai font", "customer-data leakage",
        "do not edit files", "external actions",
    ),
}


def _normalize_contract(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("`", "").lower()).strip()


def _frontmatter_body(text: str) -> str:
    parts = text.split("---", 2)
    if len(parts) < 3:
        return ""
    return re.sub(r"<!--.*?-->", "", parts[2], flags=re.DOTALL).strip()


def _frontmatter(path: Path, errors: list[str]) -> tuple[dict[str, str], str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        errors.append(f"{path.relative_to(ROOT)}: unreadable: {exc}")
        return {}, ""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        errors.append(f"{path.relative_to(ROOT)}: missing YAML frontmatter")
        return {}, text
    metadata: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" not in line or line[:1].isspace():
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip().strip("'\"")
    else:
        errors.append(f"{path.relative_to(ROOT)}: unterminated YAML frontmatter")
    return metadata, text


def _required(
    path: Path,
    data: dict[str, object],
    keys: tuple[str, ...],
    errors: list[str],
) -> None:
    for key in keys:
        value = data.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"{path.relative_to(ROOT)}: {key!r} must be a non-empty string")


def _codex_agents(errors: list[str]) -> dict[str, AgentProfile]:
    config_path = ROOT / ".codex" / "config.toml"
    try:
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        errors.append(f"{config_path.relative_to(ROOT)}: invalid TOML: {exc}")
        return {}
    agents_config = config.get("agents", {})
    if agents_config.get("enabled") is not True:
        errors.append(".codex/config.toml: agents.enabled must be true")
    concurrency = agents_config.get("max_concurrent_threads_per_session")
    if not isinstance(concurrency, int) or concurrency < 1:
        errors.append(".codex/config.toml: concurrency must be a positive integer")

    profiles: dict[str, AgentProfile] = {}
    paths = sorted((ROOT / ".codex" / "agents").glob("*.toml"))
    for path in paths:
        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except (OSError, tomllib.TOMLDecodeError) as exc:
            errors.append(f"{path.relative_to(ROOT)}: invalid TOML: {exc}")
            continue
        _required(path, data, ("name", "description", "developer_instructions"), errors)
        name = data.get("name")
        if isinstance(name, str):
            if not NAME.fullmatch(name):
                errors.append(f"{path.relative_to(ROOT)}: invalid agent name {name!r}")
            if name in profiles:
                errors.append(f"{path.relative_to(ROOT)}: duplicate agent name {name!r}")
            profiles[name] = AgentProfile(
                description=str(data.get("description", "")),
                instructions=str(data.get("developer_instructions", "")),
                read_only=data.get("sandbox_mode") == "read-only",
            )
    if not paths:
        errors.append(".codex/agents: no project agents found")
    return profiles


def _claude_agents(errors: list[str]) -> dict[str, AgentProfile]:
    profiles: dict[str, AgentProfile] = {}
    paths = sorted((ROOT / ".claude" / "agents").glob("*.md"))
    for path in paths:
        data, text = _frontmatter(path, errors)
        _required(path, data, ("name", "description"), errors)
        name = data.get("name")
        if name:
            if not NAME.fullmatch(name):
                errors.append(f"{path.relative_to(ROOT)}: invalid agent name {name!r}")
            if name in profiles:
                errors.append(f"{path.relative_to(ROOT)}: duplicate agent name {name!r}")
            tools = {tool.strip().lower() for tool in data.get("tools", "").split(",")}
            profiles[name] = AgentProfile(
                description=data.get("description", ""),
                instructions=_frontmatter_body(text),
                read_only=data.get("permissionMode", "").lower() == "plan"
                and not ({"write", "edit"} & tools),
            )
    if not paths:
        errors.append(".claude/agents: no project agents found")
    return profiles


def _validate_agent_contracts(
    codex: dict[str, AgentProfile],
    claude: dict[str, AgentProfile],
    errors: list[str],
) -> None:
    for name in codex.keys() & claude.keys():
        left = codex[name]
        right = claude[name]
        if _normalize_contract(left.description) != _normalize_contract(right.description):
            errors.append(f"agent {name!r}: descriptions differ across Codex and Claude")
        if _normalize_contract(left.instructions) != _normalize_contract(right.instructions):
            errors.append(f"agent {name!r}: behavioral instructions differ across Codex and Claude")

        expected_read_only = name in READ_ONLY_AGENTS
        if left.read_only != expected_read_only or right.read_only != expected_read_only:
            errors.append(
                f"agent {name!r}: both profiles must be "
                f"{'read-only' if expected_read_only else 'writable only when delegated'}"
            )

        required = AGENT_REQUIRED_TERMS.get(name)
        if not required:
            errors.append(f"agent {name!r}: no behavioral contract is registered")
            continue
        for platform, profile in (("Codex", left), ("Claude", right)):
            normalized = _normalize_contract(profile.instructions)
            for term in required:
                if _normalize_contract(term) not in normalized:
                    errors.append(f"agent {name!r}: {platform} instructions omit {term!r}")


def _skills(root: Path, errors: list[str]) -> dict[str, tuple[Path, str]]:
    found: dict[str, tuple[Path, str]] = {}
    for path in sorted(root.glob("*/SKILL.md")):
        data, text = _frontmatter(path, errors)
        _required(path, data, ("name", "description"), errors)
        name = data.get("name")
        if not name:
            continue
        if not NAME.fullmatch(name):
            errors.append(f"{path.relative_to(ROOT)}: invalid skill name {name!r}")
        if path.parent.name != name:
            errors.append(f"{path.relative_to(ROOT)}: directory must match skill name {name!r}")
        found[name] = (path, text)
    if not found:
        errors.append(f"{root.relative_to(ROOT)}: no project skills found")
    return found


def _validate_skills(errors: list[str]) -> int:
    codex = _skills(ROOT / ".agents" / "skills", errors)
    claude = _skills(ROOT / ".claude" / "skills", errors)
    if codex.keys() != claude.keys():
        errors.append(f"skill roots differ: Codex={sorted(codex)} Claude={sorted(claude)}")
    for name in codex.keys() & claude.keys():
        codex_text = codex[name][1]
        claude_text = claude[name][1]
        canonical_ref = f".claude/skills/{name}/SKILL.md"
        if codex_text != claude_text and not _is_strict_skill_router(codex_text, canonical_ref):
            errors.append(f"skill {name!r}: Codex entrypoint neither mirrors nor strictly routes to Claude")
    return len(codex)


def _is_strict_skill_router(text: str, canonical_ref: str) -> bool:
    body = _normalize_contract(_frontmatter_body(text))
    expected = _normalize_contract(
        "# Codex entrypoint\n\n"
        f"The canonical project procedure is `{canonical_ref}`. Read that file "
        "completely before taking action, follow every referenced repository document it requires, "
        "and treat the skill as procedure rather than authorization for SuiteCloud, browser, or "
        "deployment effects."
    )
    return body == expected


def main() -> int:
    errors: list[str] = []
    if not (ROOT / "AGENTS.md").is_file():
        errors.append("AGENTS.md: missing repository instructions")
    try:
        claude_context = (ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    except OSError as exc:
        errors.append(f"CLAUDE.md: unreadable: {exc}")
        claude_context = ""
    if "@AGENTS.md" not in claude_context:
        errors.append("CLAUDE.md: must import @AGENTS.md")

    codex_agents = _codex_agents(errors)
    claude_agents = _claude_agents(errors)
    if codex_agents.keys() != claude_agents.keys():
        errors.append(
            "agent profiles differ: "
            f"Codex={sorted(codex_agents)} Claude={sorted(claude_agents)}"
        )
    _validate_agent_contracts(codex_agents, claude_agents, errors)
    skill_count = _validate_skills(errors)

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"AI workspace valid: {len(codex_agents)} paired agents, {skill_count} skill(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
