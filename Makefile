# Zu — the development entry points.
#
#   make dev        run the app in the development host (builds the pi
#                   harness the first time)
#   make check      the type check the gates name
#   make test       the app's test suite
#   make evidence   re-take the screenshots docs/evidence keeps
#
# `nsh` is the version the repo pins: the CLI must match it or the app's
# manifest and the generated host disagree (0.4.0 rejects `notifications`
# in app/nsh.json, and every test fails before it runs). The pin lives in
# .cnb.yml; the CLI is looked up at ~/.nsh/bin (what nsh's installer
# writes), then on PATH.
#
# A worktree has no `pi-harness/dist` (gitignored) and no `node_modules`:
# `make dev` builds both. To reuse a sibling checkout's build instead:
#   ln -s ../../nsh-pi/pi-harness/dist pi-harness/dist

NSH_VERSION ?= $(shell sed -n 's/.*NSH_VERSION: *"\{0,1\}\([^" ]*\)"\{0,1\}.*/\1/p' .cnb.yml | head -1)
NSH ?= $(shell if [ -x "$(HOME)/.nsh/bin/nsh" ]; then echo "$(HOME)/.nsh/bin/nsh"; else command -v nsh; fi)
BUN ?= bun
APP := app
HARNESS := pi-harness
HARNESS_BIN := $(HARNESS)/dist/pi-acp
HARNESS_SRC := $(shell find $(HARNESS)/src -name '*.ts' 2>/dev/null)

.DEFAULT_GOAL := dev
.PHONY: dev run harness check test evidence nsh-version help

## dev: run the app in the development host
dev: nsh-version harness
	cd $(APP) && $(NSH) run

## run: `dev`
run: dev

## harness: build the pi harness the app spawns (dist/pi-acp)
harness: $(HARNESS_BIN)

$(HARNESS_BIN): $(HARNESS)/package.json $(HARNESS_SRC)
	@if [ -L $(HARNESS)/node_modules ]; then \
	  echo "pi-harness/node_modules is a symlink: replacing it with a real install"; \
	  rm $(HARNESS)/node_modules; fi
	cd $(HARNESS) && $(BUN) install && $(BUN) run build

## check: type-check the app
check: nsh-version
	$(NSH) check app

## test: run the app's tests
test: nsh-version
	cd $(APP) && $(NSH) test .

## evidence: re-take the screenshots docs/evidence keeps (macOS host)
evidence: nsh-version
	mkdir -p $(APP)/docs/evidence
	cd $(APP) && $(NSH) test containers.ui.test.tsx --target macos --filter "containers switch"

## nsh-version: fail early when the CLI is not the pinned one
nsh-version:
	@test -n "$(NSH)" -a -x "$(NSH)" || { \
	  echo "nsh is not installed; put the pinned $(NSH_VERSION) at ~/.nsh/bin/nsh" \
	       "(https://nsh.dev/install.sh) or set NSH=/path/to/nsh"; exit 1; }
	@have=$$("$(NSH)" --version | sed -n 's/.*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -1); \
	  want=$$(echo "$(NSH_VERSION)" | sed 's/^v//'); \
	  test "$$have" = "$$want" || { \
	    echo "nsh $$have is not the pinned $$want: the app's manifest would disagree with the host."; \
	    echo "Install $$want at ~/.nsh/bin/nsh, or run make NSH=/path/to/nsh."; exit 1; }
	@$(NSH) --version

## help: these targets
help:
	@sed -n 's/^## \(.*\)/\1/p' $(MAKEFILE_LIST) | sed 's/: /\t/'
