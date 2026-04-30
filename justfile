# show available recipes
default:
    @just --list

# one-shot setup from a fresh clone
setup: submodules install tsgo

# init git submodules
submodules:
    git submodule update --init

# install npm deps for root + workspaces
install:
    npm ci

# build the tsgo binary (Go toolchain required)
tsgo:
    cd extern/typescript-go && npm ci && npx hereby build

# run tstl harness tests; forwards args to vitest
tt *args:
    DUNDER_TEST=1 npx vitest run --config scripts/tstl-harness/vitest.config.ts {{args}}
