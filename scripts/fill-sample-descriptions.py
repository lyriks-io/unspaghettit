#!/usr/bin/env python3
"""
One-shot: walk every samples/<project>/*.feature.json + *.project.json and
fill in missing `description` fields with context-derived defaults.

The eShop sample predates the descriptions-mandatory validator rule. Without
this pass, "Load samples" in the tutorial 400s on save because hundreds of
internal entities (rules, effects, scenarios, parameters, entity fields,
event payload fields) lack descriptions.

The generated text is functional, not poetic: "Effect set_state on action
Create account." A future authoring pass via the MCP can replace these with
better copy. The point of THIS pass is to make the sample valid + loadable
again so the OSS quickstart works on a fresh clone.

Idempotent: only fills fields that are missing or empty. Re-run safe.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"


def desc(obj, fallback):
    """Set obj['description'] if missing/empty. Returns 1 if it was filled."""
    if not obj.get("description"):
        obj["description"] = fallback
        return 1
    return 0


def fill_feature(feat):
    filled = 0
    fname = feat.get("name", "feature")

    for surface in feat.get("surfaces", []):
        sname = surface.get("name", "surface")
        filled += desc(surface, f"{sname} surface of the {fname} feature.")

        for trans in surface.get("transitions", []):
            label = trans.get("label") or trans.get("target", "target")
            filled += desc(trans, f"Transition from {sname} to {label}.")

        for inv in surface.get("invariants", []):
            iname = inv.get("name", "invariant")
            filled += desc(inv, f"Surface invariant on {sname}: {iname}.")

        for rule in surface.get("rules", []):
            cat = rule.get("category", "rule")
            filled += desc(rule, f"Surface-level {cat} rule on {sname}.")
            eff = rule.get("effect", {})
            etype = eff.get("type", "effect")
            filled += desc(eff, f"Effect {etype} from a surface-level {cat} rule on {sname}.")

        for action in surface.get("actions", []):
            aname = action.get("name", "action")

            for param in action.get("parameters", []):
                pname = param.get("name", "parameter")
                ptype = param.get("type", "value")
                filled += desc(param, f"{ptype.capitalize()} parameter {pname} for action {aname}.")

            for rule in action.get("rules", []):
                cat = rule.get("category", "rule")
                filled += desc(rule, f"{cat.capitalize()} rule on action {aname}.")
                eff = rule.get("effect", {})
                etype = eff.get("type", "effect")
                filled += desc(eff, f"Effect {etype} from a {cat} rule on action {aname}.")

            for eff in action.get("effects", []):
                etype = eff.get("type", "effect")
                filled += desc(eff, f"Effect {etype} on action {aname}.")

            for inv in action.get("invariants", []):
                iname = inv.get("name", "invariant")
                filled += desc(inv, f"Action invariant on {aname}: {iname}.")

            for scenario in action.get("scenarios", []):
                scname = scenario.get("name", "scenario")
                filled += desc(scenario, f"Scenario {scname} on action {aname}.")
                for assertion in scenario.get("expectedAssertions", []):
                    path = assertion.get("path", "?")
                    op = assertion.get("operator", "?")
                    value = assertion.get("value")
                    val_blurb = f" {value!r}" if value is not None else ""
                    filled += desc(assertion, f"Asserts {path} {op}{val_blurb}.")

    for inv in feat.get("invariants", []):
        iname = inv.get("name", "invariant")
        filled += desc(inv, f"Feature-level invariant on {fname}: {iname}.")

    for entity in feat.get("entities", []):
        ens = entity.get("namespace", "entity")
        for field in entity.get("fields", []):
            fld_name = field.get("name", "field")
            fld_type = field.get("type", "value")
            filled += desc(field, f"{fld_type.capitalize()} field {fld_name} on entity {ens}.")

    for event in feat.get("events", []):
        evname = event.get("name", "event")
        filled += desc(event, f"Event {evname} emitted by the {fname} feature.")
        payload = event.get("payloadSchema") or []
        for field in payload:
            pf_name = field.get("name", "field")
            pf_type = field.get("type", "value")
            filled += desc(field, f"{pf_type.capitalize()} payload field {pf_name} on event {evname}.")

    return filled


def main():
    total = 0
    touched_files = []
    for path in sorted(SAMPLES.glob("*/*.feature.json")):
        data = json.load(path.open())
        feature = data.get("feature")
        if not feature:
            continue
        filled = fill_feature(feature)
        if filled > 0:
            with path.open("w", newline="\n") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")
            touched_files.append((path, filled))
            total += filled

    for path in sorted(SAMPLES.glob("*/*.project.json")):
        data = json.load(path.open())
        project = data.get("project") or {}
        # Projects only have a top-level description; rare to be missing but check.
        if "description" in project and not project.get("description"):
            project["description"] = f"{project.get('name', 'project')} sample project."
            with path.open("w", newline="\n") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")
            touched_files.append((path, 1))
            total += 1

    for p, n in touched_files:
        print(f"  {p.relative_to(ROOT)}: filled {n}")
    print(f"\nTotal: {total} descriptions filled across {len(touched_files)} files.")


if __name__ == "__main__":
    main()
