# AGENTS.md

## Project overview

Pi extension for direct browser control via CDP. 13 custom tools registered — LLM controls your real Chrome browser.

See `README.md` for the human-facing overview.

## Setup commands

```bash
# NixOS
nix profile add github:PopCat19/browser-harness-pi

# Other
uv tool install -e .

# Register with pi
pi install github:PopCat19/browser-harness-pi
```

## README workflow

Edit `readme_manifest/*.md`, then run `bash tools/generate-readme.sh`.

## Code style

- TypeScript (pi extension) + Python (CDP daemon)
- Module headers serve as in-code documentation
- Screenshots-first design: coordinate clicks through compositor
