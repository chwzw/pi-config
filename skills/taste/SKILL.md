---
name: taste
description: Manual entry to the taste-skill bundle. Loads the canonical frontend skill (v2 `design-taste-frontend`, or v1 if user requests). Invoke with `/taste`. For specialized design domains (brandkit, image-gen, brutalist, etc.) call them directly.
disable-model-invocation: true
---

# taste — dispatcher

Routes to one of two canonical frontend skills. The specialized sub-skills (brandkit, imagegen-*, brutalist-skill, minimalist-skill, soft-skill, stitch-skill, output-skill, gpt-tasteskill, image-to-code-skill, redesign-skill) are still on disk but are NOT loaded by `/taste` — invoke them directly when needed.

Base directory: `~/.pi/agent/git/github.com/Leonxlnx/taste-skill/skills`

## Routing

1. If the user mentions v1, the original, the old behaviour, or `taste-skill-v1`, read `<base>/taste-skill-v1/SKILL.md` and follow it.
2. Otherwise (default), read `<base>/taste-skill/SKILL.md` and follow it.

The file you read is the authoritative instruction set — do not work from memory or summary. Do not load multiple sub-skills.