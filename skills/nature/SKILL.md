---
name: nature
description: Paper workflow hub for Nature-family and high-impact journal work — drafting and restructuring manuscript sections, polishing or translating academic prose, adding and verifying citations and reference lists, literature search and full-text retrieval, Data Availability statements, statistical reporting audits, submission-grade figures, deep-reading paper cards and bilingual readers, mock peer review, reviewer response letters, paper-to-PPTX and paper-to-patent conversion, and experiment logging. Match the task below and read the sub-skill file before doing the work.
---

# nature — routing hub

Nineteen specialised sub-skills live alongside this file. They are intentionally not
advertised to the model individually (that costs ~3.7k tokens per request), so:

1. Match the request to one row below.
2. `read` the sub-skill's `SKILL.md` in full.
3. Follow that file as the authoritative instructions — do not work from memory.

When a sub-skill references a relative path, resolve it against its own directory.

| Task | Sub-skill to read |
| --- | --- |
| Draft or restructure manuscript sections, abstract, intro, discussion | `~/.pi/agent/skills/nature-writing/SKILL.md` |
| Polish, restructure, or translate academic prose into Nature-leaning English | `~/.pi/agent/skills/nature-polishing/SKILL.md` |
| Add citations to manuscript text, text→references, EndNote/RIS/Zotero export | `~/.pi/agent/skills/nature-citation/SKILL.md` |
| Cross-verify a reference list field by field (authors, year, volume, DOI) | `~/.pi/agent/skills/nature-ref-verifier/SKILL.md` |
| Multi-source literature search, citation verification, metric tables, citer profiling | `~/.pi/agent/skills/nature-academic-search/SKILL.md` |
| Automated literature discovery pipeline (search→score→read→archive) | `~/.pi/agent/skills/nature-literature-pipeline/SKILL.md` |
| Lawful full-text retrieval (OA, publisher API, CNKI/institutional access) | `~/.pi/agent/skills/nature-downloader/SKILL.md` |
| Deep-reading Paper Card for one paper | `~/.pi/agent/skills/nature-paper-card/SKILL.md` |
| Chinese-English side-by-side reader for a full paper | `~/.pi/agent/skills/nature-reader/SKILL.md` |
| Publication-grade figures (matplotlib/seaborn, ggplot2, composites) | `~/.pi/agent/skills/nature-figure/SKILL.md` |
| Statistical reporting audit or draft (p values, CIs, sample sizes) | `~/.pi/agent/skills/nature-statistics/SKILL.md` |
| Data Availability statements, repository plans, FAIR metadata | `~/.pi/agent/skills/nature-data/SKILL.md` |
| Simulate pre-submission peer review from the referee's side | `~/.pi/agent/skills/nature-reviewer/SKILL.md` |
| Response/rebuttal letters, point-by-point replies, revision cover letters | `~/.pi/agent/skills/nature-response/SKILL.md` |
| Paper → Nature-style Chinese PPTX (journal club, seminar, group meeting) | `~/.pi/agent/skills/nature-paper2ppt/SKILL.md` |
| Slide images/screenshots/scanned PDFs → editable PPTX | `~/.pi/agent/skills/nature-image2ppt/SKILL.md` |
| Paper/thesis/report → Chinese invention patent draft | `~/.pi/agent/skills/nature-paper-to-patent/SKILL.md` |
| Standardised experiment logs (text/voice/images → Markdown) | `~/.pi/agent/skills/nature-experiment-log/SKILL.md` |

Shared internals: `~/.pi/agent/skills/nature-shared/` holds references used by writing,
polishing, response, reader, and paper2ppt. Read it only when a sub-skill points there —
never invoke it standalone.

Each sub-skill is also available directly as a slash command (`/nature-writing`,
`/nature-figure`, …) when you prefer to invoke one explicitly.
