{
  description = "Pi-coding-agent extension for direct browser control via CDP";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSystem = f: nixpkgs.lib.genAttrs supportedSystems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forEachSystem (pkgs:
        let
          python = pkgs.python313;

          cdp-use = python.pkgs.buildPythonPackage rec {
            pname = "cdp-use";
            version = "1.4.5";
            pyproject = true;
            src = pkgs.fetchurl {
              url = "https://files.pythonhosted.org/packages/f7/7a/c549417e8c5e4dface6d5d828cd7dc72502dcea33a99f5324abf5a853ce9/cdp_use-1.4.5.tar.gz";
              hash = "sha256-DaOjLfRjNqA/9aIrxrxELNfS8tUKEY/UhW8p039tJqA=";
            };
            build-system = [ python.pkgs.hatchling ];
            dependencies = with python.pkgs; [ httpx typing-extensions websockets ];
          };

          fetch-use = python.pkgs.buildPythonPackage rec {
            pname = "fetch-use";
            version = "0.4.0";
            pyproject = true;
            src = pkgs.fetchurl {
              url = "https://files.pythonhosted.org/packages/5d/2d/66784fa8b66a04f170ad8f6598688b30b3a194dad4185b36d53da4ae1505/fetch_use-0.4.0.tar.gz";
              hash = "sha256-lRGYfUkH7G2sUB4h1mlG0QCY9mtdIbwqukGJzYG6GJo=";
            };
            build-system = [ python.pkgs.hatchling ];
          };

          browser-harness-pi = python.pkgs.buildPythonApplication {
            pname = "browser-harness-pi";
            version = "0.1.0";
            pyproject = true;
            src = self;
            build-system = [ python.pkgs.setuptools ];
            dependencies = with python.pkgs; [
              cdp-use
              fetch-use
              pillow
              websockets
            ];
          };
        in
        {
          default = browser-harness-pi;
          browser-harness-pi = browser-harness-pi;
        }
      );

      apps = forEachSystem (pkgs: {
        default = {
          type = "app";
          program = "${self.packages.${pkgs.system}.default}/bin/browser-harness";
        };
      });

      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            python3
            chromium
            nodejs
          ];
          shellHook = ''
            echo "browser-harness-pi dev shell"
            echo "  python: $(python3 --version)"
            echo "  chromium: $(chromium --version 2>/dev/null || echo 'not on PATH')"
            echo "  run: nix run .#default -- -c 'print(page_info())'"
          '';
        };
      });
    };
}
