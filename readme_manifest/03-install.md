## Install

### Nix (recommended on NixOS)

```bash
nix profile add github:PopCat19/browser-harness-pi
pi install github:PopCat19/browser-harness-pi
```

### pip / uv

```bash
git clone https://github.com/PopCat19/browser-harness-pi
cd browser-harness-pi

uv tool install -e .
export PATH="$HOME/.local/bin:$PATH"

pi install github:PopCat19/browser-harness-pi
```

Or manually:

```bash
mkdir -p ~/.pi/agent/skills/browser-harness
ln -sf "$PWD/SKILL.md" ~/.pi/agent/skills/browser-harness/SKILL.md
ln -sf "$PWD" ~/.pi/agent/extensions/browser-harness
```

## Usage

Start Chrome/Chromium with remote debugging:

```bash
chromium --remote-debugging-port=9222
```

Then in pi:

```
> Open github.com and screenshot the page
```

The LLM invokes `browser_navigate("https://github.com")` then `browser_screenshot()`.
