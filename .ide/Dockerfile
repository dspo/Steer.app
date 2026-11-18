# CNB cloud dev environment for Zu. Everything the repo's gates need is
# installed inline below; this image mirrors the CI `toolchain` stage without
# adding a shell script file to the repository.
FROM rust:slim-trixie

# Keep in lockstep with NSH_VERSION in .cnb.yml and script/lib/toolchain.ts.
ENV NSH_VERSION=v0.5.0 \
    ZU_SKIP_LIVE=1 \
    ZU_GHOSTTY_CACHE=/root/.cache/zu-ghostty \
    DEBIAN_FRONTEND=noninteractive \
    PATH=/usr/local/cargo/bin:/root/.local/bin:/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Same toolchain as CI's inline toolchain stage. Keep the two in sync.
RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends \
     git pkg-config clang unzip curl ca-certificates xz-utils \
     libgtk-4-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
     libssl-dev libffi-dev \
  && curl -fsSL https://nsh.dev/install.sh -o /tmp/nsh-install.sh \
  && nsh_home="$HOME/.nsh/dist/${NSH_VERSION}" \
  && mkdir -p "$nsh_home" "$HOME/.local/bin" \
  && NSH_INSTALL_DIR="$nsh_home" sh /tmp/nsh-install.sh \
  && ln -sf "$nsh_home/bin/nsh" "$HOME/.local/bin/nsh" \
  && curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh \
  && bash /tmp/bun-install.sh \
  && rustup component add clippy rustfmt \
  && rm -f /tmp/nsh-install.sh /tmp/bun-install.sh \
  && nsh --version && bun --version && cargo --version

# code-server (single-container WebIDE), CodeBuddy Web and SSH for VS Code /
# Cursor / JetBrains remote clients. The default dev env image ships these;
# rust:slim-trixie does not, so install them here. `bun` comes from the toolchain
# above, so no separate node/npm is needed for CodeBuddy.
RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends \
     openssh-server wget sudo \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/run/sshd \
  && curl -fsSL https://code-server.dev/install.sh -o /tmp/code-server-install.sh \
  && sh /tmp/code-server-install.sh \
  && code-server --install-extension cnbcool.cnb-welcome \
  && code-server --install-extension redhat.vscode-yaml \
  && bun install -g @tencent-ai/codebuddy-code \
  && rm -f /tmp/code-server-install.sh

ENV LANG=C.UTF-8 LANGUAGE=C.UTF-8
